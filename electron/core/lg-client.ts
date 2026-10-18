// Adapted from Celsius by Gabriel Villarinho (MIT). See licenses/Celsius-MIT.txt.
import { randomBytes } from 'node:crypto';
import { energyPeriods, type EnergyPoint, type EnergyReport } from '../../shared/energy';
import type { LGCapabilities, LGCommand, LGDevice, LGState } from '../../shared/lg';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
export const at = (value: unknown, ...keys: string[]): unknown => keys.reduce((v, key) => object(v)[key], value);
export const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
export const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

// O código da LG acompanha o erro: o tempo real precisa reconhecer alguns
// deles (ex.: 1207 = "já assinado") em vez de tratar tudo como falha.
// `auth` marca o que não adianta repetir sem trocar o token.
export class LGError extends Error {
  constructor(message: string, readonly code?: string, readonly auth = false) { super(message); }
}
export function parseEnergy(data: unknown, dates: string[]): EnergyPoint[] {
  if (at(data, 'resultCode') !== '0000' || !Array.isArray(at(data, 'result', 'dataList'))) throw new LGError('A LG não disponibilizou o histórico de consumo. Tente novamente mais tarde.');
  const rows = at(data, 'result', 'dataList') as unknown[];
  return dates.map(date => {
    const row = rows.find(row => at(row, 'usedDate') === date);
    const wh = number(at(row, 'energyUsage'));
    return { date, kwh: wh !== null && wh >= 0 ? wh / 1000 : null };
  });
}
export function capabilities(profile: unknown): LGCapabilities {
  const writable = (resource: string, key: string) => {
    const entry = at(profile, 'property', resource, key);
    return strings(at(entry, 'mode')).includes('w') ? entry : undefined;
  };
  const range = at(writable('temperature', 'targetTemperature'), 'value', 'w');
  const min = number(at(range, 'min')), max = number(at(range, 'max')), step = number(at(range, 'step')) ?? 1;
  return {
    power: ['POWER_ON', 'POWER_OFF'].every(v => strings(at(writable('operation', 'airConOperationMode'), 'value', 'w')).includes(v)),
    modes: strings(at(writable('airConJobMode', 'currentJobMode'), 'value', 'w')),
    fanSpeeds: strings(at(writable('airFlow', 'windStrength'), 'value', 'w')),
    temperature: min !== null && max !== null && min < max && step > 0 ? { min, max, step } : null,
    swing: !!writable('windDirection', 'rotateUpDown'), eco: !!writable('powerSave', 'powerSaveEnabled'),
    // Only expose the original whole-hour 1..7 UI when the profile explicitly supports writing it.
    sleep: !!writable('sleepTimer', 'relativeHourToStop') && !!writable('sleepTimer', 'relativeMinuteToStop') && strings(at(writable('sleepTimer', 'relativeStopTimer'), 'value', 'w')).includes('UNSET'),
  };
}

export function parseState(data: unknown): LGState {
  const op = at(data, 'operation', 'airConOperationMode');
  if (op !== 'POWER_ON' && op !== 'POWER_OFF') throw new LGError('A LG retornou um estado incompleto. Atualize novamente.');
  const units = at(data, 'temperatureInUnits');
  const celsius = Array.isArray(units) ? units.find(v => at(v, 'unit') === 'C') : undefined;
  const temperature = at(data, 'temperature');
  const inCelsius = at(temperature, 'unit') === 'C' || at(temperature, 'unit') === undefined;
  const hours = number(at(data, 'sleepTimer', 'relativeHourToStop')) ?? 0;
  const minutes = number(at(data, 'sleepTimer', 'relativeMinuteToStop')) ?? 0;
  return {
    power: op === 'POWER_ON', mode: string(at(data, 'airConJobMode', 'currentJobMode')),
    current: (inCelsius ? number(at(temperature, 'currentTemperature')) : null) ?? number(at(celsius, 'currentTemperature')),
    target: (inCelsius ? number(at(temperature, 'targetTemperature')) : null) ?? number(at(celsius, 'targetTemperature')),
    fan: string(at(data, 'airFlow', 'windStrength')), swing: bool(at(data, 'windDirection', 'rotateUpDown')),
    eco: bool(at(data, 'powerSave', 'powerSaveEnabled')),
    sleepHours: at(data, 'sleepTimer', 'relativeStopTimer') === 'UNSET' ? 0 : Math.ceil((hours * 60 + minutes) / 60) || null,
  };
}

export function commandPayload(input: unknown, caps: LGCapabilities, state: LGState): ObjectValue {
  const { field, value } = object(input);
  const unsupported = () => { throw new LGError('Este comando não é suportado pelo aparelho no estado atual.'); };
  if (field === 'power' && caps.power && typeof value === 'boolean') return { operation: { airConOperationMode: value ? 'POWER_ON' : 'POWER_OFF' } };
  if (!state.power) return unsupported();
  if (field === 'mode' && typeof value === 'string' && caps.modes.includes(value)) return { airConJobMode: { currentJobMode: value } };
  if (field === 'fan' && typeof value === 'string' && caps.fanSpeeds.includes(value)) return { airFlow: { windStrength: value } };
  if (field === 'target' && caps.temperature && typeof value === 'number' && Number.isFinite(value) && ['COOL', 'AUTO', 'HEAT'].includes(state.mode ?? '')) {
    const { min, max, step } = caps.temperature;
    if (value < min || value > max || Math.abs((value - min) / step - Math.round((value - min) / step)) > 0.00001) return unsupported();
    return { temperature: { targetTemperature: value, unit: 'C' } };
  }
  if (field === 'swing' && caps.swing && typeof value === 'boolean') return { windDirection: { rotateUpDown: value } };
  if (field === 'eco' && caps.eco && typeof value === 'boolean') return { powerSave: { powerSaveEnabled: value } };
  if (field === 'sleepHours' && caps.sleep && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7) return { sleepTimer: value > 0 ? { relativeHourToStop: value, relativeMinuteToStop: 0 } : { relativeStopTimer: 'UNSET' } };
  return unsupported();
}

export interface LGTransport {
  energy?(id: string, signal: AbortSignal): Promise<EnergyReport>;
  devices(signal: AbortSignal): Promise<LGDevice[]>;
  profile(id: string, signal: AbortSignal): Promise<LGCapabilities>;
  state(id: string, signal: AbortSignal): Promise<LGState>;
  send(id: string, payload: ObjectValue, signal: AbortSignal): Promise<void>;
}
export class LGClient implements LGTransport {
  constructor(private readonly token: string, private readonly clientId: string, private readonly transport: typeof fetch = fetch) {}
  private async request(method: string, route: string, signal: AbortSignal, payload?: ObjectValue): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`https://api-aic.lgthinq.com/${route}`, {
        method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { Authorization: `Bearer ${this.token}`, 'x-country': 'BR', 'x-client-id': this.clientId,
          'x-message-id': randomBytes(16).toString('base64url'), 'x-api-key': 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3',
          'x-service-phase': 'OP', 'Content-Type': 'application/json', ...(payload && route.endsWith('/control') ? { 'x-conditional-control': 'true' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch { throw new LGError('Não foi possível acessar a LG. Verifique a internet e tente novamente.'); }
    const data: unknown = await response.json().catch(() => null);
    const code = String(at(data, 'error', 'code') ?? '');
    if (response.status === 401 || response.status === 403 || ['1103','1218','1301','1302','1303','1305','1309'].includes(code)) throw new LGError('Token inválido, expirado ou sem permissão. Gere outro token com acesso aos aparelhos.', code || undefined, true);
    if (response.status === 429 || code === '1306') throw new LGError('Limite de pedidos da LG atingido. Aguarde alguns minutos antes de atualizar.', code || undefined);
    if (['1222','2209','2301'].includes(code)) throw new LGError('O aparelho está offline na LG. Confira a conexão pelo aplicativo ThinQ.', code);
    if (response.status >= 500) throw new LGError('Os servidores da LG estão indisponíveis. Tente novamente mais tarde.', code || undefined);
    if (!response.ok || at(data, 'error')) throw new LGError('A LG recusou a solicitação. Confira se o aparelho permite essa operação.', code || undefined);
    // POST pode responder sem corpo (ex.: assinaturas); GET precisa da resposta tipada.
    if (method === 'POST') return data === null ? undefined : at(data, 'response');
    if (data === null || at(data, 'response') === undefined) throw new LGError('Resposta inesperada da LG. Tente atualizar novamente.');
    return at(data, 'response');
  }
  async devices(signal: AbortSignal): Promise<LGDevice[]> {
    const data = await this.request('GET', 'devices', signal);
    if (!Array.isArray(data)) throw new LGError('A lista de aparelhos recebida da LG é inválida.');
    return data.filter(d => at(d, 'deviceInfo', 'deviceType') === 'DEVICE_AIR_CONDITIONER' && typeof at(d, 'deviceId') === 'string').map(d => ({
      id: String(at(d, 'deviceId')), name: string(at(d, 'deviceInfo', 'alias')) ?? 'Ar-condicionado LG', model: string(at(d, 'deviceInfo', 'modelName')) ?? 'LG ThinQ',
    }));
  }
  async profile(id: string, signal: AbortSignal) { return capabilities(await this.request('GET', `devices/${encodeURIComponent(id)}/profile`, signal)); }
  async state(id: string, signal: AbortSignal) { return parseState(await this.request('GET', `devices/${encodeURIComponent(id)}/state`, signal)); }
  async send(id: string, payload: ObjectValue, signal: AbortSignal) { await this.request('POST', `devices/${encodeURIComponent(id)}/control`, signal, payload); }
  // Canal de tempo real (push da nuvem): preparação do cliente MQTT descrita
  // em lg-push.ts. Os corpos e códigos seguem a biblioteca oficial da LG.
  async route(signal: AbortSignal): Promise<{ host: string; port: number }> {
    const data = await this.request('GET', 'route', signal);
    const server = string(at(data, 'mqttServer'));
    if (!server) throw new LGError('A LG não informou o servidor de tempo real desta conta.');
    const address = server.replace(/^mqtts?:\/\//, '');
    const separator = address.lastIndexOf(':');
    return separator > 0
      ? { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) || 8883 }
      : { host: address, port: 8883 };
  }
  async registerMqttClient(signal: AbortSignal) {
    await this.request('POST', 'client', signal, { type: 'MQTT', 'service-code': 'SVC202', 'device-type': '607', allowExist: true });
  }
  async issueCertificate(csr: string, signal: AbortSignal): Promise<{ certificate: string; topics: string[] }> {
    const data = await this.request('POST', 'client/certificate', signal, { 'service-code': 'SVC202', csr });
    const certificate = string(at(data, 'result', 'certificatePem'));
    const topics = strings(at(data, 'result', 'subscriptions'));
    if (!certificate || !topics.length) throw new LGError('A LG não emitiu o certificado do canal de tempo real.');
    return { certificate, topics };
  }
  async subscribe(id: string, kind: 'event' | 'push', signal: AbortSignal) {
    await this.request('POST', `${kind}/${encodeURIComponent(id)}/subscribe`, signal, kind === 'event' ? { expire: { unit: 'HOUR', timer: 4464 } } : undefined);
  }
  async energy(id: string, signal: AbortSignal): Promise<EnergyReport> {
    const route = `devices/energy/${encodeURIComponent(id)}`;
    const profile = await this.request('GET', `${route}/profile`, signal);
    if (at(profile, 'resultCode') !== '0000') throw new LGError('Não foi possível consultar o perfil de energia deste aparelho.');
    if (!strings(at(profile, 'result', 'property')).includes('energyUsage')) return { deviceId: id, daily: [], monthly: [], supported: false, error: null, updatedAt: Date.now() };
    const dates = energyPeriods();
    const usage = (period: string, range: string[]) => this.request('GET', `${route}/usage?property=energyUsage&period=${period}&startDate=${range[0]}&endDate=${range.at(-1)}`, signal);
    const [daily, monthly] = await Promise.all([usage('DAILY', dates.daily), usage('MONTHLY', dates.monthly)]);
    return { deviceId: id, daily: parseEnergy(daily, dates.daily), monthly: parseEnergy(monthly, dates.monthly), updatedAt: Date.now(), supported: true, error: null };
  }
}
export const publicError = (error: unknown) => error instanceof LGError ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
export const matchesCommand = (state: LGState, command: LGCommand) => state[command.field] === command.value;
