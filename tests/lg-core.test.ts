import test from 'node:test';
import assert from 'node:assert/strict';
import profile from './fixtures/lg-profile.json';
import stateFixture from './fixtures/lg-state.json';
import { capabilities, commandPayload, LGClient, parseState, parseEnergy, type LGTransport } from '../electron/core/lg-client';
import { energyPeriods } from '../shared/energy';
import { tariffStore } from '../electron/tariff-store';
import { mkdtempSync, rmSync } from 'node:fs';
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
test('tariff persists across store instances, supports zero and rejects invalid values', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gp-tariff-'));
  try {
    const store = tariffStore(directory); assert.equal(store.read().tariff, null);
    store.write(.95); assert.equal(tariffStore(directory).read().tariff, .95);
    for (const value of [-1, NaN, Infinity, '0.95', 1001]) assert.throws(() => store.write(value));
    store.write(0); assert.equal(store.read().tariff, 0);
    store.write(null); assert.equal(store.read().tariff, null);
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
  const session = new LGSession({ read: () => saved, write: value => { saved = { ...value }; }, clear: () => { saved = null; } }, () => {}, () => transport, async () => {});
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
