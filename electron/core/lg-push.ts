// Tempo real do LG ThinQ — assinatura do canal de push da nuvem da LG (MQTT
// sobre AWS IoT, com certificado de cliente emitido pela própria LG). É a
// mesma arquitetura que o aplicativo oficial e a integração oficial do Home
// Assistant usam; a LG mantém a biblioteca thinqconnect (Apache-2.0) com este
// fluxo, replicado aqui:
//   GET /route → o servidor MQTT da conta
//   POST /client (tipo MQTT, "aceita se já existir") → registra o cliente
//   par de chaves RSA 2048 + CSR (CN=lg_thinq, SHA-512) → POST /client/certificate
//   devolve o certificado do cliente e o tópico do canal
//   conexão MQTT com TLS dos dois lados (certificado do cliente + CA raiz da
//   Amazon); POST /event/{id}/subscribe entrega as mudanças de estado e
//   POST /push/{id}/subscribe as notificações do aparelho (a assinatura de
//   eventos é renovada a cada 24 h, como na integração oficial)
// Sem ela o painel só descobre mudanças pelo polling; com ela, a nuvem
// empurra cada alteração de estado em ~1 s, inclusive as feitas por fora
// (controle remoto, aplicativo ThinQ). Nada de credencial ou mensagem crua
// em log: só o relatório do aparelho escolhido chega adiante.
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import mqtt from 'mqtt';
import * as x509 from '@peculiar/x509';
import { at, LGClient, LGError } from './lg-client';

type ObjectValue = Record<string, unknown>;

// Raiz da Amazon para o MQTT (IoT Core): https://www.amazontrust.com/repository/
export const AMAZON_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----`;

export type LGPushStatus = 'connecting' | 'connected' | 'reconnecting' | 'blocked' | 'stopped';

// O que o push precisa do cliente HTTP (implementado por LGClient; dublê nos testes).
export interface LGPushApi {
  route(signal: AbortSignal): Promise<{ host: string; port: number }>;
  registerMqttClient(signal: AbortSignal): Promise<void>;
  issueCertificate(csr: string, signal: AbortSignal): Promise<{ certificate: string; topics: string[] }>;
  subscribe(id: string, kind: 'event' | 'push', signal: AbortSignal): Promise<void>;
}

// Fábrica do socket MQTT: `mqtt` no app, dublê nos testes.
export interface PushClient {
  on(event: string, listener: (...args: any[]) => void): void;
  subscribe(topics: string[], options: { qos: 0 | 1 | 2 }, callback?: (error?: Error) => void): void;
  end(force?: boolean): void;
}

export interface MqttConnection {
  host: string; port: number; clientId: string; key: string; cert: string; ca: string;
}

export interface LGPushOptions {
  token: string;
  clientId: string;
  deviceId: string;
  onReport: (report: ObjectValue) => void;
  onStatus: (status: LGPushStatus) => void;
}

export interface LGPushLink { start(): void; stop(): void }

// Extrai o relatório de estado de uma mensagem do canal. Só DEVICE_STATUS do
// aparelho escolhido interessa; DEVICE_PUSH (notificações) e outros aparelhos
// ficam de fora. O relatório traz apenas os campos que mudaram.
export function pushReport(message: unknown, deviceId: string): ObjectValue | null {
  if (at(message, 'pushType') !== 'DEVICE_STATUS' || at(message, 'deviceId') !== deviceId) return null;
  const report = at(message, 'report');
  return report !== null && typeof report === 'object' && !Array.isArray(report) ? report as ObjectValue : null;
}

// Certificado do cliente novo a cada conexão: gera a chave RSA no WebCrypto
// nativo e assina o CSR (CN=lg_thinq, SHA-512) com @peculiar/x509 — sem
// bibliotecas com pendências de auditoria e sem nada persistido em disco.
export async function createCsr(): Promise<{ privateKey: string; csr: string }> {
  x509.cryptoProvider.set(webcrypto);
  const keys = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-512' },
    true, ['sign', 'verify'],
  );
  const request = await x509.Pkcs10CertificateRequestGenerator.create({
    name: 'CN=lg_thinq', keys,
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
  });
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const body = pkcs8.toString('base64').replace(/(.{64})/g, '$1\n').trim();
  // A LG espera o CSR sem os cabeçalhos PEM e em uma linha só.
  return { privateKey: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`, csr: request.toString('base64').replace(/\s+/g, '') };
}

const openMqtt = (connection: MqttConnection): PushClient => mqtt.connect(`mqtts://${connection.host}:${connection.port}`, {
  clientId: connection.clientId, key: connection.key, cert: connection.cert, ca: connection.ca,
  clean: false, keepalive: 30, reconnectPeriod: 0, connectTimeout: 15000,
}) as unknown as PushClient;

const RETRY_MS = [3000, 10000, 30000, 60000];
const RENEW_MS = 24 * 60 * 60 * 1000;
// Motivos definitivos (token sem permissão de eventos, modelo sem suporte,
// limite de assinaturas): insistir não resolve, então o canal para.
const BLOCKED_CODES = new Set(['1214', '1219', '1221', '1312']);
const isBlocked = (error: unknown) => error instanceof LGError && (error.auth || BLOCKED_CODES.has(error.code ?? ''));
const describe = (error: unknown) => error instanceof LGError ? `${error.message}${error.code ? ` (${error.code})` : ''}` : 'falha de rede ou do serviço';

export class LGPush implements LGPushLink {
  private client: PushClient | null = null;
  private api: LGPushApi | null = null;
  private controller: AbortController | null = null;
  private currentStatus: LGPushStatus = 'stopped';
  private attempt = 0;
  private stopped = true;
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private renew: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly options: LGPushOptions,
    private readonly makeApi: (token: string, clientId: string) => LGPushApi = (token, clientId) => new LGClient(token, clientId),
    private readonly open: (connection: MqttConnection) => PushClient = openMqtt,
    private readonly certificate: () => Promise<{ privateKey: string; csr: string }> = createCsr,
  ) {}

  get status() { return this.currentStatus; }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.clearTimers();
    this.controller?.abort(); this.controller = null;
    this.dropClient();
    this.api = null;
    this.setStatus('stopped');
  }

  private setStatus(status: LGPushStatus) {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.options.onStatus(status);
  }

  private clearTimers() {
    clearTimeout(this.retry); this.retry = undefined;
    clearInterval(this.renew); this.renew = undefined;
  }

  private dropClient() {
    const client = this.client; this.client = null;
    if (client) { try { client.end(true); } catch { /* já estava fechando */ } }
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.setStatus('reconnecting');
    this.retry = setTimeout(() => { this.attempt += 1; void this.connect(); }, RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]);
    this.retry.unref?.();
  }

  // Cada tentativa refaz o fluxo inteiro (rota, registro, certificado e
  // assinaturas) — é barato e garante que o canal volte inteiro depois de
  // qualquer queda, como no restabelecimento do aplicativo oficial.
  private async connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    const current = () => !this.stopped && generation === this.generation;
    this.setStatus(this.attempt ? 'reconnecting' : 'connecting');
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.dropClient();
    this.api = null;
    try {
      const api = this.makeApi(this.options.token, this.options.clientId);
      const { host, port } = await api.route(controller.signal);
      await api.registerMqttClient(controller.signal);
      const { privateKey, csr } = await this.certificate();
      const { certificate, topics } = await api.issueCertificate(csr, controller.signal);
      await api.subscribe(this.options.deviceId, 'event', controller.signal);
      try {
        await api.subscribe(this.options.deviceId, 'push', controller.signal);
      } catch (error) {
        // 1207 = "já assinado": a assinatura anterior continua valendo.
        if (!(error instanceof LGError && error.code === '1207')) throw error;
      }
      if (!current()) return;
      this.api = api;
      this.attach(host, port, privateKey, certificate, topics, generation);
    } catch (error) {
      if (!current()) return;
      if (isBlocked(error)) {
        this.stopped = true;
        this.setStatus('blocked');
        console.warn(`[lg-push] tempo real indisponível: ${describe(error)}`);
        return;
      }
      console.warn(`[lg-push] tentativa de conexão falhou: ${describe(error)}`);
      this.scheduleRetry();
    }
  }

  private attach(host: string, port: number, key: string, cert: string, topics: string[], generation: number) {
    const client = this.open({ host, port, clientId: this.options.clientId, key, cert, ca: AMAZON_ROOT_CA });
    this.client = client;
    const mine = () => !this.stopped && generation === this.generation && this.client === client;
    client.on('connect', () => {
      if (!mine()) return;
      this.attempt = 0;
      client.subscribe(topics, { qos: 1 }, error => { if (error && mine()) console.warn(`[lg-push] falha ao assinar o canal: ${error.message}`); });
      this.setStatus('connected');
      // A assinatura de eventos expira; renovar todo dia é o que a integração
      // oficial do Home Assistant faz com a mesma API.
      clearInterval(this.renew);
      this.renew = setInterval(() => void this.renewSubscribe(), RENEW_MS);
      this.renew.unref?.();
    });
    client.on('message', (_topic: string, payload: unknown) => { if (mine()) this.receive(payload); });
    client.on('close', () => {
      if (this.client !== client) return;
      this.client = null;
      this.api = null;
      this.clearTimers();
      this.scheduleRetry();
    });
    client.on('error', () => { /* o evento close logo em seguida decide a reconexão */ });
  }

  private async renewSubscribe() {
    const api = this.api, controller = this.controller;
    if (this.stopped || !api || !controller || !this.client) return;
    const generation = this.generation;
    try {
      await api.subscribe(this.options.deviceId, 'event', controller.signal);
    } catch {
      if (!this.stopped && generation === this.generation) {
        // Sem renovar, os eventos param; refaz o canal inteiro pelo caminho normal.
        clearInterval(this.renew); this.renew = undefined;
        this.dropClient();
        this.api = null;
        this.scheduleRetry();
      }
    }
  }

  private receive(payload: unknown) {
    let message: unknown;
    try {
      message = JSON.parse(typeof payload === 'string' ? payload : Buffer.from(payload as Uint8Array).toString('utf8'));
    } catch { return; }
    const report = pushReport(message, this.options.deviceId);
    if (report) this.options.onReport(report);
  }
}
