// Escuta em tempo real do Tuya Message Service (Pulsar sobre WebSocket) — o
// mesmo canal de push que os apps oficiais usam. Sem ela o painel só descobre
// mudanças pelo polling (20 s); com ela, a nuvem empurra cada alteração de
// estado em ~1 s, inclusive as feitas por fora (Smart Life, controle físico).
//
// Protocolo replicado dos SDKs oficiais (Python, Go, .NET):
//   URL {host}ws/v2/consumer/persistent/{id}/out/event/{id}-sub
//       ?ackTimeoutMillis=3000&subscriptionType=Failover
//   autenticação por headers username/password, com a senha derivada
//       md5(id + md5(secret))[8:24]
//   envelope JSON { messageId, payload, properties: { em } }
//   payload (base64) { protocol, data }; data é o conteúdo cifrado em
//   AES-GCM (nonce de 12 bytes na frente, etiqueta de 16 no fim) ou no
//   modo legado AES-ECB; a chave são os 16 caracteres centrais do secret.
// Nada de credencial ou payload cru em log ou estado: só os pares
// código/valor do aparelho escolhido chegam adiante.
import { createDecipheriv, createHash } from 'node:crypto';
import WebSocket from 'ws';
import type { ElginProject, ElginRegion } from '../../shared/elgin';

// Espelho dos SDKs oficiais. Somente `us` (Western America) foi validado ao
// vivo neste projeto; as demais regiões seguem o mesmo formato.
export const PULSAR_HOSTS: Record<ElginRegion, string> = {
  us: 'wss://mqe.tuyaus.com:8285/', // Western America
  ue: 'wss://mqe.tuyaus.com:8285/', // Eastern America
  eu: 'wss://mqe.tuyaeu.com:8285/', // Central Europe
  we: 'wss://mqe.tuyaeu.com:8285/', // Western Europe
  cn: 'wss://mqe.tuyacn.com:8285/',
  in: 'wss://mqe.tuyain.com:8285/',
  sg: 'wss://mqe-sg.iotbing.com:8285/',
};

export type ElginPushStatus = 'connecting' | 'connected' | 'reconnecting' | 'unauthorized' | 'stopped';

// Senha usada como header da assinatura (derivação dos SDKs oficiais).
export const pushPassword = (accessId: string, accessSecret: string) =>
  createHash('md5').update(accessId + createHash('md5').update(accessSecret, 'utf8').digest('hex'), 'utf8').digest('hex').slice(8, 24);

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const at = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((current, key) => object(current)[key], value);

// Decifra o conteúdo de uma mensagem e devolve o documento JSON, ou null para
// qualquer coisa inesperada (formato, chave errada, etiqueta inválida).
export function decryptPushData(data: unknown, accessSecret: string, model: string | undefined): unknown {
  if (typeof data !== 'string' || !data) return null;
  try {
    const key = Buffer.from(accessSecret.slice(8, 24), 'utf8');
    const bytes = Buffer.from(data, 'base64');
    let clear: Buffer;
    if (model === 'aes_gcm') {
      if (bytes.length < 12 + 16) return null;
      const decipher = createDecipheriv('aes-128-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(bytes.length - 16));
      clear = Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]);
    } else {
      const decipher = createDecipheriv('aes-128-ecb', key, null);
      decipher.setAutoPadding(false);
      clear = Buffer.concat([decipher.update(bytes), decipher.final()]);
    }
    // O modo legado pode vir com preenchimento de zeros ou PKCS#7 no fim;
    // caracteres de controle sobrando não fazem parte do JSON e são cortados.
    return JSON.parse(clear.toString('utf8').replace(/[\u0000-\u001f]+$/, ''));
  } catch { return null; }
}

export interface ElginPushReport { deviceId: string; values: ObjectValue }

// Extrai o par aparelho/valores de um documento decifrado. Protocolo 4 traz
// `{ devId, status: [{ code, value }] }`; o IoT Core (1000) traz
// `{ bizCode: "devicePropertyMessage", bizData: { devId, properties: [...] } }`.
// Eventos de ciclo de vida (online/offline) não têm estado e são descartados.
export function pushValues(document: unknown): ElginPushReport | null {
  const bizCode = string(at(document, 'bizCode'));
  if (bizCode === 'devicePropertyMessage') return collect(string(at(document, 'bizData', 'devId')), at(document, 'bizData', 'properties'));
  if (bizCode) return null;
  return collect(string(at(document, 'devId')) ?? string(at(document, 'deviceId')), at(document, 'status'));
}

function collect(deviceId: string | null, list: unknown): ElginPushReport | null {
  if (!deviceId || !Array.isArray(list)) return null;
  const values: ObjectValue = {};
  for (const entry of list) {
    const code = string(at(entry, 'code'));
    if (code) values[code] = at(entry, 'value');
  }
  return Object.keys(values).length ? { deviceId, values } : null;
}

export interface ElginPushOptions {
  project: ElginProject;
  deviceId: string;
  onValues: (values: ObjectValue) => void;
  onStatus: (status: ElginPushStatus) => void;
}

export interface ElginPushLink { start(): void; stop(): void }

// Fábrica do socket: `ws` no app, dublê nos testes.
export interface PushSocket {
  on(event: string, listener: (...args: any[]) => void): void;
  send(data: string): void;
  ping(): void;
  terminate(): void;
  close(): void;
}

const RETRY_MS = [3000, 10000, 30000, 60000];
const PING_MS = 30000;
const TWIN_MS = 5000;

export class ElginPush implements ElginPushLink {
  private socket: PushSocket | null = null;
  private currentStatus: ElginPushStatus = 'stopped';
  private attempt = 0;
  private stopped = true;
  private ping: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly recent = new Map<string, number>();
  constructor(
    private readonly options: ElginPushOptions,
    private readonly open: (url: string, password: string) => PushSocket = (url, password) => new WebSocket(url, { headers: { username: options.project.accessId, password } }) as unknown as PushSocket,
  ) {}

  get status() { return this.currentStatus; }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.ping); this.ping = undefined;
    clearTimeout(this.retry); this.retry = undefined;
    const socket = this.socket; this.socket = null;
    if (socket) { try { socket.terminate(); } catch { /* já estava fechando */ } }
    this.setStatus('stopped');
  }

  private setStatus(status: ElginPushStatus) {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.options.onStatus(status);
  }

  private connect() {
    if (this.stopped) return;
    this.setStatus(this.attempt ? 'reconnecting' : 'connecting');
    const { project } = this.options;
    const id = encodeURIComponent(project.accessId);
    const url = `${PULSAR_HOSTS[project.region]}ws/v2/consumer/persistent/${id}/out/event/${id}-sub?ackTimeoutMillis=3000&subscriptionType=Failover`;
    const socket = this.open(url, pushPassword(project.accessId, project.accessSecret));
    this.socket = socket;
    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempt = 0;
      this.setStatus('connected');
      this.ping = setInterval(() => { try { socket.ping(); } catch { /* o close decide a reconexão */ } }, PING_MS);
      this.ping.unref();
    });
    socket.on('message', raw => { if (this.socket === socket && !this.stopped) this.receive(String(raw)); });
    socket.on('unexpected-response', (_request: unknown, response: { statusCode?: number }) => {
      if (this.socket !== socket) return;
      // 401 no handshake: o serviço de mensagens não está habilitado/assinado
      // no projeto — insistir não resolve, então paramos de tentar.
      if (response?.statusCode === 401) { this.stopped = true; this.socket = null; this.setStatus('unauthorized'); try { socket.terminate(); } catch { /* encerrado */ } }
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.ping); this.ping = undefined;
      if (this.stopped) return;
      this.setStatus('reconnecting');
      this.retry = setTimeout(() => { this.attempt += 1; this.connect(); }, RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]);
      this.retry.unref();
    });
    socket.on('error', () => { /* o evento close logo em seguida decide a reconexão */ });
  }

  private receive(raw: string) {
    let envelope: unknown;
    try { envelope = JSON.parse(raw); } catch { return; }
    const messageId = string(at(envelope, 'messageId'));
    if (messageId) { try { this.socket?.send(JSON.stringify({ messageId })); } catch { /* sem ack, a nuvem reenvia depois */ } }
    const payloadText = string(at(envelope, 'payload'));
    if (!payloadText) return;
    let payload: unknown;
    try { payload = JSON.parse(Buffer.from(payloadText, 'base64').toString('utf8')); } catch { return; }
    const protocol = at(payload, 'protocol');
    if (protocol !== 4 && protocol !== 1000) return;
    const model = string(at(envelope, 'properties', 'em')) ?? undefined;
    const report = pushValues(decryptPushData(at(payload, 'data'), this.options.project.accessSecret, model));
    if (!report || report.deviceId !== this.options.deviceId) return;
    // A nuvem manda o mesmo relatório duas vezes (protocolos 4 e 1000);
    // mantém o primeiro e ignora o gêmeo dentro da janela curta.
    const key = JSON.stringify(Object.entries(report.values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const now = Date.now();
    for (const [previous, seen] of this.recent) if (now - seen > TWIN_MS) this.recent.delete(previous);
    const last = this.recent.get(key);
    this.recent.set(key, now);
    if (last !== undefined && now - last <= TWIN_MS) return;
    this.options.onValues(report.values);
  }
}
