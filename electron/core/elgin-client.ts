// Cliente da Tuya Cloud OpenAPI usado pelo adaptador Elgin (marco F).
// Assinatura HMAC-SHA256 conforme developer.tuya.com/en/docs/iot/singnature.
// Nenhuma resposta crua é repassada: apenas campos conhecidos entram nos
// contratos, e mensagens de erro nunca expõem credenciais ou payloads.
import { createHash, createHmac } from 'node:crypto';
import type { ElginCapabilities, ElginCommand, ElginDevice, ElginProject, ElginRegion, ElginState } from '../../shared/elgin';

export const HOSTS: Record<ElginRegion, string> = {
  us: 'openapi.tuyaus.com', // Western America
  ue: 'openapi-ueaz.tuyaus.com', // Eastern America
  eu: 'openapi.tuyaeu.com', // Central Europe
  we: 'openapi-weaz.tuyaeu.com', // Western Europe
  cn: 'openapi.tuyacn.com',
  in: 'openapi.tuyain.com',
  sg: 'openapi-sg.iotbing.com',
};

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const at = (value: unknown, ...keys: string[]): unknown => keys.reduce((v, key) => object(v)[key], value);
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const json = (value: unknown): unknown => {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
};

export class ElginError extends Error {}

export function parseDevices(data: unknown): ElginDevice[] {
  const list = at(data, 'devices');
  if (!Array.isArray(list)) return [];
  return list.filter(d => at(d, 'category') === 'kt' && typeof at(d, 'id') === 'string').map(d => ({
    id: String(at(d, 'id')),
    name: (string(at(d, 'name')) ?? 'Ar-condicionado').trim() || 'Ar-condicionado',
    model: string(at(d, 'product_name')) ?? 'Elgin',
  }));
}

/** Capacidades a partir da lista de funções aceitas (/functions → result.functions). */
export function capabilities(functions: unknown): ElginCapabilities {
  const list = Array.isArray(functions) ? functions : [];
  const fn = (code: string) => list.find(f => at(f, 'code') === code);
  const boolean = (code: string) => at(fn(code), 'type') === 'Boolean';
  const range = (code: string): string[] => {
    const values = at(json(at(fn(code), 'values')), 'range');
    return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
  };
  const spec = json(at(fn('temp_set'), 'values'));
  const scale = number(at(spec, 'scale')) ?? 1;
  const min = number(at(spec, 'min')), max = number(at(spec, 'max')), step = number(at(spec, 'step'));
  const temperature = at(fn('temp_set'), 'type') === 'Integer' && min !== null && max !== null && min < max && step !== null && step > 0
    ? { min: min / 10 ** scale, max: max / 10 ** scale, step: step / 10 ** scale, scale }
    : null;
  return {
    power: boolean('switch'),
    modes: range('mode'),
    temperature,
    swingHorizontal: boolean('switch_horizontal'),
    eco: boolean('mode_eco'),
    sleep: boolean('sleep'),
    light: boolean('light'),
    lock: boolean('lock'),
  };
}

/** Estado a partir do status (/status → array de { code, value }), em °C. */
export function parseState(data: unknown, scales: { target?: number; current?: number } = {}): ElginState {
  const list = Array.isArray(data) ? data : [];
  const value = (code: string) => at(list.find(p => at(p, 'code') === code), 'value');
  const power = bool(value('switch'));
  if (power === null) throw new ElginError('O aparelho retornou um estado incompleto. Atualize novamente.');
  const decode = (code: string, scale: number | undefined) => {
    const raw = number(value(code));
    return raw === null ? null : raw / 10 ** (scale ?? 1);
  };
  return {
    power, mode: string(value('mode')),
    current: decode('temp_current', scales.current), target: decode('temp_set', scales.target),
    eco: bool(value('mode_eco')), sleep: bool(value('sleep')), light: bool(value('light')),
    lock: bool(value('lock')), swingHorizontal: bool(value('switch_horizontal')),
  };
}

/** Comando do contrato → par { code, value } aceito pela Tuya, com validação estrita. */
export function commandPayload(input: unknown, caps: ElginCapabilities, state: ElginState): { code: string; value: boolean | string | number } {
  const { field, value } = object(input);
  const unsupported = () => { throw new ElginError('Este comando não é suportado pelo aparelho no estado atual.'); };
  if (field === 'power' && caps.power && typeof value === 'boolean') return { code: 'switch', value };
  if (!state.power) return unsupported();
  if (field === 'mode' && typeof value === 'string' && caps.modes.includes(value)) return { code: 'mode', value };
  if (field === 'target' && caps.temperature && typeof value === 'number' && Number.isFinite(value)) {
    const { min, max, step, scale } = caps.temperature;
    if (value < min || value > max || Math.abs((value - min) / step - Math.round((value - min) / step)) > 0.00001) return unsupported();
    return { code: 'temp_set', value: Math.round(value * 10 ** scale) };
  }
  if (field === 'swingHorizontal' && caps.swingHorizontal && typeof value === 'boolean') return { code: 'switch_horizontal', value };
  if (field === 'eco' && caps.eco && typeof value === 'boolean') return { code: 'mode_eco', value };
  if (field === 'sleep' && caps.sleep && typeof value === 'boolean') return { code: 'sleep', value };
  if (field === 'light' && caps.light && typeof value === 'boolean') return { code: 'light', value };
  if (field === 'lock' && caps.lock && typeof value === 'boolean') return { code: 'lock', value };
  return unsupported();
}

export interface ElginLogEntry { code: string; value: unknown; time: number }

export interface ElginTransport {
  devices(signal: AbortSignal): Promise<ElginDevice[]>;
  profile(id: string, signal: AbortSignal): Promise<ElginCapabilities>;
  state(id: string, signal: AbortSignal): Promise<ElginState>;
  logs?(id: string, query: { start: number; end: number; codes: string }, signal: AbortSignal): Promise<ElginLogEntry[]>;
  send(id: string, payload: { code: string; value: boolean | string | number }, signal: AbortSignal): Promise<void>;
}

const failure = (code: string, status: number): string => {
  if (status === 429) return 'Limite de pedidos da Tuya atingido. Aguarde alguns minutos antes de atualizar.';
  if (code === '1004' || code === '2009') return 'Credenciais do projeto Tuya inválidas. Confira o Access ID e o Access Secret.';
  if (code === '1010') return 'A sessão com a Tuya expirou. Tente novamente.';
  if (code === '1106') return 'A conta do aplicativo ainda não está vinculada a este projeto Tuya.';
  if (code === '2406') return 'A região do projeto não bate com o vínculo da conta. Ajuste a região nas configurações.';
  if (code === '28841105') return 'Faltam serviços de API autorizados no projeto Tuya.';
  if (code === '28841107') return 'O datacenter do projeto não respondeu. Confira a região do projeto Tuya.';
  if (status >= 500) return 'Os servidores da Tuya estão indisponíveis. Tente novamente mais tarde.';
  return 'A Tuya recusou a solicitação. Confira se o aparelho permite essa operação.';
};

export class ElginClient implements ElginTransport {
  private token = '';
  private readonly scales = new Map<string, { target: number; current: number }>();
  constructor(private readonly project: ElginProject, private readonly transport: typeof fetch = fetch) {}

  private async attempt(
    method: string, route: string, signal: AbortSignal,
    query: Record<string, string | number> | null, body: unknown, auth: boolean,
  ): Promise<{ ok: true; result: unknown } | { ok: false; code: string; status: number }> {
    const t = String(Date.now());
    const qs = query ? Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('&') : '';
    const urlPath = qs ? `${route}?${qs}` : route;
    const payload = body === undefined ? '' : JSON.stringify(body);
    const stringToSign = [method, createHash('sha256').update(payload).digest('hex'), '', urlPath].join('\n');
    const sign = createHmac('sha256', this.project.accessSecret).update(this.project.accessId + (auth ? this.token : '') + t + stringToSign).digest('hex').toUpperCase();
    let response: Response;
    try {
      response = await this.transport(`https://${HOSTS[this.project.region]}${urlPath}`, {
        method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: {
          client_id: this.project.accessId, sign_method: 'HMAC-SHA256', t, sign,
          ...(auth ? { access_token: this.token } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : payload,
      });
    } catch { throw new ElginError('Não foi possível acessar a Tuya. Verifique a internet e tente novamente.'); }
    const data: unknown = await response.json().catch(() => null);
    if (at(data, 'success') === true) return { ok: true, result: at(data, 'result') };
    return { ok: false, code: String(at(data, 'code') ?? ''), status: response.status };
  }

  private async request(
    method: string, route: string, signal: AbortSignal,
    options: { query?: Record<string, string | number>; body?: unknown; auth?: boolean } = {},
  ): Promise<unknown> {
    const auth = options.auth !== false;
    if (auth && !this.token) await this.refresh(signal);
    const first = await this.attempt(method, route, signal, options.query ?? null, options.body, auth);
    if (first.ok) return first.result;
    // Um token expirado é renovado uma única vez; nada além disso é repetido.
    if (auth && first.code === '1010') {
      await this.refresh(signal);
      const second = await this.attempt(method, route, signal, options.query ?? null, options.body, auth);
      if (second.ok) return second.result;
      throw new ElginError(failure(second.code, second.status));
    }
    throw new ElginError(failure(first.code, first.status));
  }

  async refresh(signal: AbortSignal): Promise<unknown> {
    const result = await this.request('GET', '/v1.0/token', signal, { query: { grant_type: 1 }, auth: false });
    const token = string(at(result, 'access_token'));
    if (!token) throw new ElginError('A Tuya não devolveu um token de acesso. Tente novamente.');
    this.token = token;
    return result;
  }

  async devices(signal: AbortSignal): Promise<ElginDevice[]> {
    const rows: unknown[] = [];
    let lastRowKey: string | null = null;
    for (let page = 0; page < 10; page++) {
      const query: Record<string, string | number> = { size: 50 };
      if (lastRowKey) query.last_row_key = lastRowKey;
      const result = await this.request('GET', '/v1.0/iot-01/associated-users/devices', signal, { query });
      const pageRows = at(result, 'devices');
      if (Array.isArray(pageRows)) rows.push(...pageRows);
      const key = string(at(result, 'last_row_key'));
      if (at(result, 'has_more') !== true || !key) break;
      lastRowKey = key;
    }
    return parseDevices({ devices: rows });
  }

  async profile(id: string, signal: AbortSignal): Promise<ElginCapabilities> {
    const [functions, specifications] = await Promise.all([
      this.request('GET', `/v1.0/iot-03/devices/${encodeURIComponent(id)}/functions`, signal),
      this.request('GET', `/v1.1/devices/${encodeURIComponent(id)}/specifications`, signal),
    ]);
    const scaleOf = (list: unknown, code: string): number => {
      const entry = Array.isArray(list) ? list.find(f => at(f, 'code') === code) : undefined;
      const scale = number(at(json(at(entry, 'values')), 'scale'));
      return scale !== null && Number.isInteger(scale) && scale >= 0 && scale <= 4 ? scale : 1;
    };
    this.scales.set(id, {
      target: scaleOf(at(specifications, 'functions'), 'temp_set'),
      current: scaleOf(at(specifications, 'status'), 'temp_current'),
    });
    return capabilities(at(functions, 'functions'));
  }

  async state(id: string, signal: AbortSignal): Promise<ElginState> {
    return parseState(await this.request('GET', `/v1.0/iot-03/devices/${encodeURIComponent(id)}/status`, signal), this.scales.get(id));
  }

  // Logs de DP (edições gratuitas entregam os últimos 7 dias). A paginação
  // segue o protocolo da Tuya: a página seguinte usa start_row_key = next_row_key.
  async logs(id: string, query: { start: number; end: number; codes: string }, signal: AbortSignal): Promise<ElginLogEntry[]> {
    const entries: ElginLogEntry[] = [];
    let rowKey: string | null = null;
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string | number> = { type: 7, size: 100, start_time: query.start, end_time: query.end, codes: query.codes };
      if (rowKey) params.start_row_key = rowKey;
      const result = await this.request('GET', `/v1.0/devices/${encodeURIComponent(id)}/logs`, signal, { query: params });
      const rows = at(result, 'logs');
      if (Array.isArray(rows)) for (const row of rows) {
        const code = string(at(row, 'code')), time = number(at(row, 'event_time'));
        if (code && time !== null) entries.push({ code, value: at(row, 'value'), time });
      }
      const next = string(at(result, 'next_row_key'));
      if (at(result, 'has_next') !== true || !next || next === rowKey) break;
      rowKey = next;
    }
    return entries;
  }

  async send(id: string, payload: { code: string; value: boolean | string | number }, signal: AbortSignal): Promise<void> {
    const result = await this.request('POST', `/v1.0/iot-03/devices/${encodeURIComponent(id)}/commands`, signal, { body: { commands: [payload] } });
    if (result === false) throw new ElginError('O aparelho não aceitou o comando.');
  }
}

export const publicError = (error: unknown) => error instanceof ElginError ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
export const matchesCommand = (state: ElginState, command: ElginCommand) => state[command.field] === command.value;
