import test from 'node:test';
import assert from 'node:assert/strict';
import profile from './fixtures/lg-profile.json';
import stateFixture from './fixtures/lg-state.json';
import { capabilities, commandPayload, LGClient, LGError, parseState, parseEnergy, type LGTransport } from '../electron/core/lg-client';
import { energyPeriods } from '../shared/energy';
import { tariffStore } from '../electron/tariff-store';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LGSession, type Credentials } from '../electron/core/lg-session';

// Fixtures from Celsius (MIT), licenses/Celsius-MIT.txt. Tokens below are synthetic.
const caps = capabilities(profile.response), state = parseState(stateFixture.response);
const token = 'thinqpat_synthetic-test-only';
const device = { id: 'test-ac', name: 'Test AC', model: 'Test' };
test('energy calendar uses São Paulo dates and crosses years; missing readings stay null', () => {
  const periods = energyPeriods(new Date('2026-01-01T02:00:00Z'));
  assert.equal(periods.today, '20251231');
  assert.equal(periods.daily.at(-1), '20251230');
  assert.deepEqual(periods.monthly, ['202507','202508','202509','202510','202511','202512']);
  assert.deepEqual(parseEnergy({ resultCode: '0000', result: { dataList: [{ usedDate: '20261015', energyUsage: 6249 }, { usedDate: '20261014', energyUsage: 0 }] } }, ['20261013','20261014','20261015']), [{ date: '20261013', kwh: null }, { date: '20261014', kwh: 0 }, { date: '20261015', kwh: 6.249 }]);
  assert.throws(() => parseEnergy({ resultCode: '2201' }, []));
});
test('energy settings persist across store instances, support zero and reject invalid values', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gp-tariff-'));
  try {
    const store = tariffStore(directory); assert.deepEqual(store.read(), { tariff: null, averagePower: null });
    store.write({ tariff: .95, averagePower: .7 }); assert.deepEqual(tariffStore(directory).read(), { tariff: .95, averagePower: .7 });
    for (const value of [-1, NaN, Infinity, '0.95', 1001]) assert.throws(() => store.write({ tariff: value, averagePower: null }));
    for (const value of [-0.1, 0.01, 11, '0.7', NaN]) assert.throws(() => store.write({ tariff: null, averagePower: value }));
    for (const value of [null, 'nonsense', 0.95, []]) assert.throws(() => store.write(value));
    store.write({ tariff: 0, averagePower: null }); assert.deepEqual(store.read(), { tariff: 0, averagePower: null });
    store.write({ tariff: null, averagePower: null }); assert.deepEqual(store.read(), { tariff: null, averagePower: null });
    // Arquivo antigo (só tarifa) continua legível.
    writeFileSync(path.join(directory, 'energy-settings.json'), JSON.stringify({ tariff: 0.80477 }), 'utf8');
    assert.deepEqual(store.read(), { tariff: 0.80477, averagePower: null });
  } finally { rmSync(directory, { recursive: true }); }
});
test('energy client uses energy endpoints and normalizes returned Wh', async () => {
  const routes: string[] = [];
  const client = new LGClient(token, 'id', (async url => {
    routes.push(String(url));
    return Response.json({ response: String(url).endsWith('/profile') ? { resultCode: '0000', result: { property: ['energyUsage'] } } : { resultCode: '0000', result: { dataList: [] } } });
  }) as typeof fetch);
  const report = await client.energy('test/id', new AbortController().signal);
  assert.equal(report.daily.length, 30); assert.equal(report.monthly.length, 6);
  assert.ok(report.daily.every(p => p.kwh === null));
  assert.ok(routes[0].endsWith('/devices/energy/test%2Fid/profile'));
  assert.ok(routes[1].includes('period=DAILY')); assert.ok(routes[2].includes('period=MONTHLY'));
});
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup(overrides: Partial<LGTransport> = {}) {
  let saved: Credentials | null = null;
  const transport: LGTransport = { devices: async () => [device, { ...device, id: 'second' }], profile: async () => caps, state: async () => ({ ...state }), send: async () => {}, ...overrides };
  // Push dublê: os testes de núcleo não abrem conexão real (o push tem suíte
  // própria em lg-push.test.ts).
  const session = new LGSession({ read: () => saved, write: value => { saved = { ...value }; }, clear: () => { saved = null; } }, () => {}, () => transport, async () => {}, () => ({ start: () => {}, stop: () => {} }));
  return { session, saved: () => saved };
}
test('energy requests coalesce, cache and discard results after disconnect', async () => {
  let calls = 0;
  const pending = deferred<import('../shared/energy').EnergyReport>();
  const { session } = setup({ energy: async () => { calls++; return pending.promise; } });
  await session.connect(token);
  const first = session.energy(device.id), second = session.energy(device.id);
  pending.resolve({ deviceId: device.id, daily: [], monthly: [], supported: true, updatedAt: Date.now(), error: null });
  await Promise.all([first, second]); await session.energy(device.id); assert.equal(calls, 1);
  session.disconnect(); assert.ok((await session.energy(device.id)).error); session.dispose();
  const late = deferred<import('../shared/energy').EnergyReport>();
  const other = setup({ energy: () => late.promise }).session;
  await other.connect(token); const reading = other.energy(device.id); other.disconnect();
  late.resolve({ deviceId: device.id, daily: [], monthly: [], supported: true, updatedAt: Date.now(), error: null });
  assert.ok((await reading).error); other.dispose();
});
test('LG fixture capabilities, Celsius fallback and strict command validation', () => {
  assert.deepEqual(caps.temperature, { min: 18, max: 30, step: .5 });
  assert.equal(state.current, 26);
  assert.equal(parseState({ ...stateFixture.response, temperature: { unit: 'F', currentTemperature: 78 } }).current, 26);
  assert.deepEqual(commandPayload({ field: 'target', value: 22.5 }, caps, state), { temperature: { targetTemperature: 22.5, unit: 'C' } });
  for (const value of [17, 31, 22.2, NaN, '23']) assert.throws(() => commandPayload({ field: 'target', value }, caps, state));
  assert.throws(() => commandPayload({ field: 'fan', value: 'INVENTED' }, caps, state));
  assert.throws(() => commandPayload({ field: 'eco', value: true }, caps, { ...state, power: false }));
  assert.throws(() => commandPayload({ field: 'power', value: true }, capabilities({}), state));
  assert.deepEqual(commandPayload({ field: 'sleepHours', value: 0 }, caps, state), { sleepTimer: { relativeStopTimer: 'UNSET' } });
  assert.throws(() => parseState({}));
});
test('HTTP uses fixed LG host, BR headers, encoded IDs and filtered devices', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = new LGClient(token, 'test-client', (async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return Response.json({ response: [{ deviceId: 'test-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Test AC', modelName: 'Test' } }, { deviceId: 'washer', deviceInfo: { deviceType: 'DEVICE_WASHER' } }] });
  }) as typeof fetch);
  const signal = new AbortController().signal;
  assert.deepEqual(await client.devices(signal), [device]);
  await client.send('id/with?special', { operation: { airConOperationMode: 'POWER_OFF' } }, signal);
  assert.equal(requests[1].url, 'https://api-aic.lgthinq.com/devices/id%2Fwith%3Fspecial/control');
  const headers = requests[1].init.headers as Record<string, string>;
  assert.equal(headers['x-country'], 'BR'); assert.equal(headers.Authorization, `Bearer ${token}`);
  assert.equal(headers['x-conditional-control'], 'true'); assert.equal(headers['x-message-id'].length, 22);
  assert.equal(requests[0].init.redirect, 'error');
});
test('HTTP auth, rate limit and network errors never expose response details', async () => {
  for (const [status, expected] of [[401, /Token inválido/], [429, /Limite de pedidos/], [503, /indisponíveis/]] as const) {
    const client = new LGClient(token, 'id', (async () => Response.json({ detail: token }, { status })) as typeof fetch);
    await assert.rejects(client.devices(new AbortController().signal), expected);
  }
  const client = new LGClient(token, 'id', async () => { throw new Error(token); });
  await assert.rejects(client.devices(new AbortController().signal), error => error instanceof Error && !error.message.includes(token));
});
test('tempo real: rota, registro, certificado e assinaturas com os cabeçalhos e o ID codificado', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = new LGClient(token, 'test-client', (async (url, init) => {
    requests.push({ url: String(url), init: init! });
    const route = String(url).replace('https://api-aic.lgthinq.com/', '');
    if (route === 'route') return Response.json({ response: { apiServer: 'x', mqttServer: 'mqtts://mqtt.example.test:8883', webSocketServer: 'y' } });
    if (route === 'client/certificate') return Response.json({ response: { result: { certificatePem: 'CERT', subscriptions: ['app/clients/test-client/push'] } } });
    return Response.json({ response: {} });
  }) as typeof fetch);
  const signal = new AbortController().signal;
  assert.deepEqual(await client.route(signal), { host: 'mqtt.example.test', port: 8883 });
  await client.registerMqttClient(signal);
  assert.deepEqual(await client.issueCertificate('CSR', signal), { certificate: 'CERT', topics: ['app/clients/test-client/push'] });
  await client.subscribe('id/with?special', 'event', signal);
  await client.subscribe('id/with?special', 'push', signal);
  assert.equal(requests[1].url, 'https://api-aic.lgthinq.com/client');
  assert.equal(requests[1].init.body, JSON.stringify({ type: 'MQTT', 'service-code': 'SVC202', 'device-type': '607', allowExist: true }));
  assert.equal(requests[3].url, 'https://api-aic.lgthinq.com/event/id%2Fwith%3Fspecial/subscribe');
  assert.equal(requests[3].init.body, JSON.stringify({ expire: { unit: 'HOUR', timer: 4464 } }));
  assert.equal(requests[4].url, 'https://api-aic.lgthinq.com/push/id%2Fwith%3Fspecial/subscribe');
  assert.equal(requests[4].init.body, undefined);
  // O cabeçalho exclusivo de controle não acompanha as assinaturas.
  assert.equal((requests[1].init.headers as Record<string, string>)['x-conditional-control'], undefined);
  assert.equal((requests[3].init.headers as Record<string, string>)['x-conditional-control'], undefined);
  // Endereço sem porta devolve o padrão do MQTT seguro.
  const plain = new LGClient(token, 'id', (async () => Response.json({ response: { mqttServer: 'mqtts://only.example' } })) as typeof fetch);
  assert.deepEqual(await plain.route(new AbortController().signal), { host: 'only.example', port: 8883 });
});
test('erros da LG chegam com código e marca de autorização (o push trata o 1207)', async () => {
  const rejected = new LGClient(token, 'id', (async () => Response.json({ error: { code: '1207', message: 'already subscribed' } }, { status: 400 })) as typeof fetch);
  await assert.rejects(rejected.subscribe('x', 'push', new AbortController().signal), (error: unknown) => error instanceof LGError && error.code === '1207' && !error.auth);
  const auth = new LGClient(token, 'id', (async () => Response.json({ error: { code: '1301' } })) as typeof fetch);
  await assert.rejects(auth.devices(new AbortController().signal), (error: unknown) => error instanceof LGError && error.auth === true);
});
test('disconnect during discovery cannot save credentials or resurrect the session', async () => {
  const pending = deferred<typeof device[]>();
  const { session, saved } = setup({ devices: () => pending.promise });
  const connecting = session.connect(token);
  session.disconnect(); pending.resolve([device]); await connecting;
  assert.equal(saved(), null); assert.equal(session.get().connected, false);
  session.dispose();
});
test('old reads are discarded after selecting a different device', async () => {
  const pending = deferred<typeof state>(); let slow = false;
  const { session } = setup({ state: async id => slow && id === 'test-ac' ? pending.promise : { ...state, target: id === 'second' ? 25 : 18 } });
  await session.connect(token); slow = true;
  const reading = session.refresh(); await session.select('second'); pending.resolve({ ...state, target: 19 }); await reading;
  assert.equal(session.get().selectedId, 'second'); assert.equal(session.get().state?.target, 25);
  assert.equal(JSON.stringify(session.get()).includes(token), false);
  session.dispose();
});
test('commands use confirmed state, reject concurrent sends and never retry an ambiguous POST', async () => {
  const pending = deferred<void>(); let sends = 0;
  const { session } = setup({ send: async () => { sends++; await pending.promise; throw new Error('timeout'); } });
  await session.connect(token);
  const sending = session.command(device.id, { field: 'power', value: false });
  assert.equal(session.get().state?.power, true);
  await session.command(device.id, { field: 'power', value: false });
  pending.resolve(); await sending;
  assert.equal(sends, 1); assert.ok(session.get().error); assert.equal(session.get().state?.power, true);
  session.dispose();
});
test('disconnect during control drops the late result and clears credentials', async () => {
  const pending = deferred<void>();
  const { session, saved } = setup({ send: () => pending.promise });
  await session.connect(token); const sending = session.command(device.id, { field: 'power', value: false });
  session.disconnect(); pending.resolve(); await sending;
  assert.equal(saved(), null); assert.equal(session.get().state, null); assert.equal(session.get().connected, false);
  session.dispose();
});

test('abrir o painel consulta na hora quando a última leitura está velha', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let reads = 0;
  const { session } = setup({ state: async () => { reads++; return { ...state }; } });
  await session.connect(token);
  assert.equal(reads, 1);
  session.setVisible(false); session.setVisible(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1, 'leitura recente não provoca consulta');
  session.setVisible(false);
  t.mock.timers.setTime(Date.now() + 60000);
  session.setVisible(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2, 'leitura velha consulta na hora');
  assert.equal(session.get().busy, false);
  session.dispose();
});
