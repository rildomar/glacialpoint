import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import functionsFixture from './fixtures/elgin-functions.json';
import statusFixture from './fixtures/elgin-status.json';
import { capabilities, parseState, type ElginTransport } from '../electron/core/elgin-client';
import { ElginSession, type ElginCredentials } from '../electron/core/elgin-session';
import { decryptPushData, ElginPush, pushPassword, pushValues, type ElginPushOptions, type ElginPushStatus, type PushSocket } from '../electron/core/elgin-push';
import type { ElginDevice, ElginProject } from '../shared/elgin';

// Fixtures sintéticas, como no teste do núcleo (marco F). Segredos são fictícios.
const project: ElginProject = { accessId: 'synthetic-access-id-01', accessSecret: 'synthetic-secret-value-0001', region: 'us' };
const caps = capabilities(functionsFixture.functions);
const state = parseState(statusFixture);
const device: ElginDevice = { id: 'synthetic-ac', name: 'Teste', model: 'Elgin' };

const key = () => Buffer.from(project.accessSecret.slice(8, 24), 'utf8');
const encrypt = (document: unknown, model: 'aes_gcm' | 'ecb' = 'aes_gcm') => {
  const clear = Buffer.from(JSON.stringify(document), 'utf8');
  if (model === 'ecb') {
    // A nuvem legada preenche o último bloco com zeros (PaddingMode.Zeros).
    const cipher = createCipheriv('aes-128-ecb', key(), null);
    cipher.setAutoPadding(false);
    const padded = Buffer.concat([clear, Buffer.alloc((16 - clear.length % 16) % 16)]);
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
  }
  const nonce = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-128-gcm', key(), nonce);
  const body = Buffer.concat([cipher.update(clear), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
};
const envelope = (document: unknown, protocol = 4, model?: string) => JSON.stringify({
  messageId: `message-${protocol}`,
  payload: Buffer.from(JSON.stringify({ protocol, data: encrypt(document, model === 'aes_gcm' ? 'aes_gcm' : 'ecb') })).toString('base64'),
  properties: model ? { em: model } : {},
});

class FakeSocket implements PushSocket {
  readonly listeners = new Map<string, ((...args: any[]) => void)[]>();
  readonly sent: string[] = [];
  pings = 0;
  terminated = false;
  constructor(readonly url: string, readonly password: string) {}
  on(event: string, listener: (...args: any[]) => void) { const list = this.listeners.get(event); if (list) list.push(listener); else this.listeners.set(event, [listener]); }
  emit(event: string, ...args: any[]) { for (const listener of [...this.listeners.get(event) ?? []]) listener(...args); }
  send(data: string) { this.sent.push(data); }
  ping() { this.pings += 1; }
  close() { this.emit('close'); }
  terminate() { this.terminated = true; this.emit('close'); }
}

function wire(deviceId = 'synthetic-ac') {
  const sockets: FakeSocket[] = [];
  const statuses: ElginPushStatus[] = [];
  const reports: Record<string, unknown>[] = [];
  const push = new ElginPush(
    { project, deviceId, onValues: values => reports.push(values), onStatus: status => statuses.push(status) },
    (url, password) => { const socket = new FakeSocket(url, password); sockets.push(socket); return socket; },
  );
  return { push, sockets, statuses, reports };
}

function setupSession() {
  let saved: ElginCredentials | null = null;
  let options: ElginPushOptions | null = null;
  const calls = { started: 0, stopped: 0 };
  const transport: ElginTransport = { devices: async () => [device, { ...device, id: 'second' }], profile: async () => caps, state: async () => ({ ...state }), send: async () => {} };
  const session = new ElginSession(
    { read: () => saved, write: value => { saved = { ...value }; }, clear: () => { saved = null; } },
    () => {},
    () => transport,
    async () => {},
    link => { options = link; return { start: () => { calls.started += 1; }, stop: () => { calls.stopped += 1; } }; },
  );
  return { session, calls, push: () => options! };
}

test('pushPassword: derivação dos SDKs (16 caracteres, determinística)', () => {
  const password = pushPassword(project.accessId, project.accessSecret);
  assert.equal(password, '717a4d96344b016d');
  assert.equal(pushPassword('a'.repeat(8), 'b'.repeat(8)).length, 16);
});

test('decryptPushData: GCM e ECB legado decodificam; estranhos devolvem null', () => {
  const document = { devId: 'synthetic-ac', status: [{ code: 'light', value: true }] };
  assert.deepEqual(decryptPushData(encrypt(document), project.accessSecret, 'aes_gcm'), document);
  assert.deepEqual(decryptPushData(encrypt(document, 'ecb'), project.accessSecret, undefined), document);
  assert.equal(decryptPushData('%%%', project.accessSecret, 'aes_gcm'), null);
  assert.equal(decryptPushData(encrypt(document), 'outro-segredo-qualquer-0002', 'aes_gcm'), null);
});

test('pushValues: protocolo 4, IoT Core 1000 e descarte de eventos de ciclo de vida', () => {
  assert.deepEqual(pushValues({ devId: 'synthetic-ac', status: [{ code: 'light', value: true }, { code: 'temp_set', value: 230 }] }), { deviceId: 'synthetic-ac', values: { light: true, temp_set: 230 } });
  assert.deepEqual(pushValues({ bizCode: 'devicePropertyMessage', bizData: { devId: 'synthetic-ac', properties: [{ code: 'mode', value: 'cold' }] } }), { deviceId: 'synthetic-ac', values: { mode: 'cold' } });
  assert.equal(pushValues({ bizCode: 'deviceOnline', bizData: { devId: 'synthetic-ac' } }), null);
  assert.equal(pushValues({ status: [] }), null);
  assert.equal(pushValues(null), null);
});

test('ElginPush: assina o canal certo, autentica, confirma a mensagem e filtra o aparelho', () => {
  const { push, sockets, statuses, reports } = wire();
  push.start();
  const socket = sockets[0];
  assert.equal(socket.url, 'wss://mqe.tuyaus.com:8285/ws/v2/consumer/persistent/synthetic-access-id-01/out/event/synthetic-access-id-01-sub?ackTimeoutMillis=3000&subscriptionType=Failover');
  assert.equal(socket.password, pushPassword(project.accessId, project.accessSecret));
  socket.emit('open');
  assert.deepEqual(statuses, ['connecting', 'connected']);
  socket.emit('message', envelope({ devId: 'synthetic-ac', status: [{ code: 'light', value: true }, { code: 'temp_set', value: 230 }] }, 4, 'aes_gcm'));
  assert.deepEqual(reports, [{ light: true, temp_set: 230 }]);
  assert.deepEqual(socket.sent, ['{"messageId":"message-4"}']);
  // O gêmeo do outro protocolo esconde-se atrás do primeiro.
  socket.emit('message', envelope({ bizCode: 'devicePropertyMessage', bizData: { devId: 'synthetic-ac', properties: [{ code: 'light', value: true }, { code: 'temp_set', value: 230 }] } }, 1000, 'aes_gcm'));
  assert.equal(reports.length, 1);
  socket.emit('message', envelope({ devId: 'outro-aparelho', status: [{ code: 'switch', value: false }] }, 4, 'aes_gcm'));
  assert.equal(reports.length, 1);
  push.stop();
  assert.equal(statuses.at(-1), 'stopped');
  assert.equal(socket.terminated, true);
});

test('ElginPush: 401 no handshake encerra as tentativas (serviço desligado no projeto)', () => {
  const { push, sockets, statuses } = wire();
  push.start();
  sockets[0].emit('unexpected-response', {}, { statusCode: 401 });
  assert.equal(statuses.at(-1), 'unauthorized');
  assert.equal(sockets[0].terminated, true);
  assert.equal(sockets.length, 1);
  push.stop();
});

test('ElginPush: queda do socket entra em reconexão e o stop limpa tudo', () => {
  const { push, sockets, statuses } = wire();
  push.start();
  sockets[0].emit('open');
  sockets[0].emit('close');
  assert.equal(statuses.at(-1), 'reconnecting');
  push.stop();
  assert.equal(statuses.at(-1), 'stopped');
});

test('sessão: liga a escuta no connect, aplica valores no estado e desliga ao desconectar', async () => {
  const { session, calls, push } = setupSession();
  await session.connect(project);
  assert.equal(calls.started, 1); assert.equal(calls.stopped, 0);
  const options = push();
  assert.equal(options.deviceId, 'synthetic-ac');
  assert.deepEqual(options.project, project);
  assert.equal(session.get().realtime, null);
  options.onStatus('connecting');
  assert.equal(session.get().realtime, 'connecting');
  options.onStatus('connected');
  assert.equal(session.get().realtime, 'on');
  await new Promise(resolve => setTimeout(resolve, 5));
  const before = session.get().updatedAt;
  options.onValues({ light: false, temp_set: 230 });
  const merged = session.get();
  assert.equal(merged.state?.light, false); assert.equal(merged.state?.target, 23);
  assert.notEqual(merged.updatedAt, before);
  options.onValues({ light: false });
  assert.equal(session.get().updatedAt, merged.updatedAt);
  options.onStatus('unauthorized');
  assert.equal(session.get().realtime, 'blocked');
  session.disconnect();
  const result = session.get();
  assert.equal(result.realtime, null); assert.equal(result.connected, false);
  assert.equal(calls.stopped, 1);
});

test('sessão: troca de aparelho, suspensão e encerramento administram a escuta', async () => {
  const { session, calls } = setupSession();
  await session.connect(project);
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
