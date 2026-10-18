import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as x509 from '@peculiar/x509';
import profile from './fixtures/lg-profile.json';
import stateFixture from './fixtures/lg-state.json';
import { capabilities, LGError, parseState, type LGTransport } from '../electron/core/lg-client';
import { AMAZON_ROOT_CA, createCsr, LGPush, pushReport, type LGPushApi, type LGPushOptions, type LGPushStatus, type MqttConnection, type PushClient } from '../electron/core/lg-push';
import { LGSession, type Credentials } from '../electron/core/lg-session';

// Fixtures do projeto (Celsius, MIT). Token sintético como nos demais testes.
const token = 'thinqpat_synthetic-test-only';
const caps = capabilities(profile.response);
const state = parseState(stateFixture.response);
const device = { id: 'test-ac', name: 'Test AC', model: 'Test' };

class FakeMqtt implements PushClient {
  readonly listeners = new Map<string, ((...args: any[]) => void)[]>();
  readonly subscribed: { topics: string[]; qos: number }[] = [];
  ended = false;
  constructor(readonly connection: MqttConnection) {}
  on(event: string, listener: (...args: any[]) => void) { const list = this.listeners.get(event); if (list) list.push(listener); else this.listeners.set(event, [listener]); }
  emit(event: string, ...args: any[]) { for (const listener of [...this.listeners.get(event) ?? []]) listener(...args); }
  subscribe(topics: string[], options: { qos: 0 | 1 | 2 }, callback?: (error?: Error) => void) { this.subscribed.push({ topics, qos: options.qos }); callback?.(); }
  end() { this.ended = true; }
}

// Dublês de tudo que toca a rede: API HTTP, socket MQTT e emissão do CSR.
function wire(overrides: Partial<LGPushApi> = {}) {
  const statuses: LGPushStatus[] = [];
  const reports: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const clients: FakeMqtt[] = [];
  const api: LGPushApi = {
    route: async () => { calls.push('route'); return { host: 'mqtt.example.test', port: 8883 }; },
    registerMqttClient: async () => { calls.push('register'); },
    issueCertificate: async csr => { calls.push(`certificate:${csr}`); return { certificate: 'CERT', topics: ['app/clients/test/push'] }; },
    subscribe: async (id, kind) => { calls.push(`${kind}:${id}`); },
    ...overrides,
  };
  const push = new LGPush(
    { token, clientId: 'glacialpoint-test', deviceId: device.id, onReport: report => reports.push(report), onStatus: status => statuses.push(status) },
    () => api,
    connection => { const client = new FakeMqtt(connection); clients.push(client); return client; },
    async () => ({ privateKey: 'KEY', csr: 'CSR' }),
  );
  return { push, api, statuses, reports, calls, clients };
}

const settled = () => new Promise(resolve => setImmediate(resolve));

test('createCsr: pedido de certificado válido com CN=lg_thinq, sem cabeçalhos PEM', async () => {
  const { privateKey, csr } = await createCsr();
  assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----/);
  assert.equal(/[^A-Za-z0-9+/=]/.test(csr), false);
  const request = new x509.Pkcs10CertificateRequest(Buffer.from(csr, 'base64'));
  assert.equal(request.subject, 'CN=lg_thinq');
  assert.ok(await request.verify(), 'a assinatura do CSR confere com a chave pública');
});

test('pushReport: só DEVICE_STATUS do aparelho escolhido, com relatório em objeto', () => {
  assert.deepEqual(pushReport({ deviceId: device.id, pushType: 'DEVICE_STATUS', report: { operation: { airConOperationMode: 'POWER_OFF' } } }, device.id), { operation: { airConOperationMode: 'POWER_OFF' } });
  assert.equal(pushReport({ deviceId: 'outro', pushType: 'DEVICE_STATUS', report: {} }, device.id), null);
  assert.equal(pushReport({ deviceId: device.id, pushType: 'DEVICE_PUSH', pushCode: 'X' }, device.id), null);
  assert.equal(pushReport({ deviceId: device.id, pushType: 'DEVICE_STATUS' }, device.id), null);
  assert.equal(pushReport(null, device.id), null);
});

test('LGPush: registra o cliente, emite o certificado, conecta, assina e entrega o relatório', async () => {
  const { push, statuses, reports, calls, clients } = wire();
  push.start();
  await settled();
  assert.deepEqual(calls, ['route', 'register', 'certificate:CSR', `event:${device.id}`, `push:${device.id}`]);
  assert.equal(clients.length, 1);
  assert.deepEqual(clients[0].connection, { host: 'mqtt.example.test', port: 8883, clientId: 'glacialpoint-test', key: 'KEY', cert: 'CERT', ca: AMAZON_ROOT_CA });
  clients[0].emit('connect');
  assert.deepEqual(statuses, ['connecting', 'connected']);
  assert.deepEqual(clients[0].subscribed, [{ topics: ['app/clients/test/push'], qos: 1 }]);
  clients[0].emit('message', 'app/clients/test/push', JSON.stringify({ deviceId: device.id, pushType: 'DEVICE_STATUS', report: { temperature: { targetTemperature: 22.5, unit: 'C' } } }));
  assert.deepEqual(reports, [{ temperature: { targetTemperature: 22.5, unit: 'C' } }]);
  clients[0].emit('message', 'app/clients/test/push', '{quebrado');
  clients[0].emit('message', 'app/clients/test/push', JSON.stringify({ deviceId: 'outro', pushType: 'DEVICE_STATUS', report: { temperature: { targetTemperature: 30 } } }));
  assert.equal(reports.length, 1);
  push.stop();
  assert.equal(statuses.at(-1), 'stopped');
  assert.equal(clients[0].ended, true);
});

test('LGPush: queda do canal entra em reconexão com espera e o stop limpa tudo', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { push, statuses, calls, clients } = wire();
  push.start();
  await settled();
  clients[0].emit('connect');
  clients[0].emit('close');
  assert.equal(statuses.at(-1), 'reconnecting');
  t.mock.timers.tick(3000);
  await settled();
  assert.equal(clients.length, 2);
  assert.deepEqual(calls.slice(5), ['route', 'register', 'certificate:CSR', `event:${device.id}`, `push:${device.id}`]);
  push.stop();
  assert.equal(statuses.at(-1), 'stopped');
});

test('LGPush: token sem permissão ou aparelho sem suporte desligam as tentativas (blocked)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failures: Partial<LGPushApi>[] = [
    { route: async () => { throw new LGError('Token inválido, expirado ou sem permissão. Gere outro token com acesso aos aparelhos.', '1103', true); } },
    { subscribe: async () => { throw new LGError('A LG recusou a solicitação. Confira se o aparelho permite essa operação.', '1214'); } },
  ];
  for (const failure of failures) {
    const { push, statuses, clients } = wire(failure);
    push.start();
    await settled();
    assert.equal(statuses.at(-1), 'blocked');
    t.mock.timers.tick(3600000);
    await settled();
    assert.equal(clients.length, 0, 'depois de blocked não há novas tentativas');
    assert.equal(statuses.at(-1), 'blocked');
    push.stop();
    assert.equal(statuses.at(-1), 'stopped');
  }
});

test('LGPush: assinatura de push já existente (1207) não derruba o canal', async () => {
  const { push, statuses, clients } = wire({ subscribe: async (_id, kind) => { if (kind === 'push') throw new LGError('A LG recusou a solicitação.', '1207'); } });
  push.start();
  await settled();
  assert.equal(clients.length, 1);
  clients[0].emit('connect');
  assert.equal(statuses.at(-1), 'connected');
  push.stop();
});

test('LGPush: renova a assinatura de eventos a cada dia; falha refaz o canal inteiro', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let renewals = 0;
  const { push, api, statuses, clients } = wire({ subscribe: async (_id, kind) => { if (kind === 'event') renewals += 1; } });
  push.start();
  await settled();
  clients[0].emit('connect');
  assert.equal(renewals, 1);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  await settled();
  assert.equal(renewals, 2, 'a assinatura de eventos foi renovada');
  let failNext = true;
  api.subscribe = async () => { if (failNext) { failNext = false; throw new Error('sem rede'); } };
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  await settled();
  assert.equal(clients[0].ended, true);
  assert.equal(statuses.at(-1), 'reconnecting');
  t.mock.timers.tick(3000);
  await settled();
  assert.equal(clients.length, 2, 'o canal voltou inteiro (certificado e assinaturas de novo)');
  push.stop();
  assert.equal(statuses.at(-1), 'stopped');
});

function setupSession() {
  let saved: Credentials | null = null;
  let options: LGPushOptions | null = null;
  const calls = { started: 0, stopped: 0 };
  const transport: LGTransport = { devices: async () => [device, { ...device, id: 'second' }], profile: async () => caps, state: async () => ({ ...state }), send: async () => {} };
  const session = new LGSession(
    { read: () => saved, write: value => { saved = { ...value }; }, clear: () => { saved = null; } },
    () => {},
    () => transport,
    async () => {},
    link => { options = link; return { start: () => { calls.started += 1; }, stop: () => { calls.stopped += 1; } }; },
  );
  return { session, calls, push: () => options! };
}

test('sessão: liga a escuta no connect, aplica o relatório no estado e desliga ao desconectar', async () => {
  const { session, calls, push } = setupSession();
  await session.connect(token);
  assert.equal(calls.started, 1); assert.equal(calls.stopped, 0);
  const options = push();
  assert.equal(options.deviceId, device.id);
  assert.equal(options.token, token);
  assert.equal(session.get().realtime, null);
  options.onStatus('connecting');
  assert.equal(session.get().realtime, 'connecting');
  options.onStatus('connected');
  assert.equal(session.get().realtime, 'on');
  await new Promise(resolve => setTimeout(resolve, 5));
  const before = session.get().updatedAt;
  options.onReport({ operation: { airConOperationMode: 'POWER_OFF' }, temperature: { targetTemperature: 22.5, unit: 'C' } });
  const merged = session.get();
  assert.equal(merged.state?.power, false); assert.equal(merged.state?.target, 22.5);
  assert.notEqual(merged.updatedAt, before);
  // Relatório sem mudança real não mexe no relógio nem no estado.
  options.onReport({ temperature: { targetTemperature: 22.5, unit: 'C' } });
  assert.equal(session.get().updatedAt, merged.updatedAt);
  options.onStatus('blocked');
  assert.equal(session.get().realtime, 'blocked');
  session.disconnect();
  assert.equal(session.get().realtime, null); assert.equal(session.get().connected, false);
  assert.equal(calls.stopped, 1);
  session.dispose();
});

test('sessão: troca de aparelho, suspensão e encerramento administram a escuta', async () => {
  const { session, calls } = setupSession();
  await session.connect(token);
  await session.select('second');
  assert.equal(calls.started, 2); assert.equal(calls.stopped, 1);
  session.suspend();
  assert.equal(calls.stopped, 2);
  session.resume();
  assert.equal(calls.started, 3);
  await new Promise(resolve => setTimeout(resolve, 0));
  session.dispose();
  assert.equal(calls.stopped, 3);
});
