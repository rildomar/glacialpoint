import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import devicesFixture from './fixtures/elgin-devices.json';
import functionsFixture from './fixtures/elgin-functions.json';
import specificationsFixture from './fixtures/elgin-specifications.json';
import statusFixture from './fixtures/elgin-status.json';
import { capabilities, commandPayload, ElginClient, parseDevices, parseState, type ElginTransport } from '../electron/core/elgin-client';
import { ElginSession, type ElginCredentials } from '../electron/core/elgin-session';
import type { ElginDevice, ElginProject, ElginState } from '../shared/elgin';

// Fixtures anonimizados a partir de respostas reais da Tuya (marco F). Segredos são sintéticos.
const project: ElginProject = { accessId: 'synthetic-access-id-01', accessSecret: 'synthetic-secret-value-0001', region: 'us' };
const caps = capabilities(functionsFixture.functions);
const state = parseState(statusFixture);
const device: ElginDevice = { id: 'synthetic-ac', name: 'Teste', model: 'Elgin' };

test('fixtures: capacidades anunciadas, estado em °C e escala do protocolo', () => {
  assert.deepEqual(caps, { power: true, modes: ['cold', 'hot', 'wet', 'wind', 'auto'], temperature: { min: 16, max: 90, step: 1, scale: 1 }, swingHorizontal: true, eco: true, sleep: true, light: true, lock: true });
  assert.deepEqual(state, { power: true, mode: 'cold', current: 25, target: 24, eco: false, sleep: false, light: true, lock: false, swingHorizontal: false });
  assert.deepEqual(parseState(statusFixture, { target: 0, current: 2 }), { ...state, target: 240, current: 2.5 });
  assert.throws(() => parseState([]));
  assert.deepEqual(parseDevices(devicesFixture), [{ id: 'synthetic-ac-0001', name: 'Ar da sala', model: 'Wi-Fi air conditioner' }]);
});

test('commandPayload: só o anunciado, faixa e passo estritos, nada otimista', () => {
  assert.deepEqual(commandPayload({ field: 'power', value: false }, caps, state), { code: 'switch', value: false });
  assert.deepEqual(commandPayload({ field: 'mode', value: 'wind' }, caps, state), { code: 'mode', value: 'wind' });
  assert.deepEqual(commandPayload({ field: 'target', value: 22 }, caps, state), { code: 'temp_set', value: 220 });
  assert.deepEqual(commandPayload({ field: 'target', value: 16 }, caps, state), { code: 'temp_set', value: 160 });
  assert.deepEqual(commandPayload({ field: 'light', value: false }, caps, state), { code: 'light', value: false });
  assert.deepEqual(commandPayload({ field: 'eco', value: true }, caps, state), { code: 'mode_eco', value: true });
  assert.deepEqual(commandPayload({ field: 'sleep', value: true }, caps, state), { code: 'sleep', value: true });
  assert.deepEqual(commandPayload({ field: 'lock', value: true }, caps, state), { code: 'lock', value: true });
  assert.deepEqual(commandPayload({ field: 'swingHorizontal', value: true }, caps, state), { code: 'switch_horizontal', value: true });
  for (const value of [15.9, 22.5, 91, NaN, '23']) assert.throws(() => commandPayload({ field: 'target', value }, caps, state));
  assert.throws(() => commandPayload({ field: 'mode', value: 'INVENTED' }, caps, state));
  assert.throws(() => commandPayload({ field: 'light', value: true }, caps, { ...state, power: false }));
  assert.throws(() => commandPayload({ field: 'power', value: true }, capabilities([]), state));
  assert.throws(() => commandPayload({ field: 'fan', value: 'auto' }, caps, state));
});

test('HTTP: host da região, assinatura HMAC, paginação e comando assinado no corpo', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const pages = [
    { devices: [devicesFixture.devices[0]], has_more: true, last_row_key: 'PAGE-TWO' },
    { devices: [devicesFixture.devices[1]], has_more: false },
  ];
  const client = new ElginClient(project, (async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (String(url).endsWith('/v1.0/token?grant_type=1')) return Response.json({ success: true, result: { access_token: 'synthetic-token', expire_time: 7200 } });
    if (String(url).includes('associated-users/devices')) return Response.json({ success: true, result: pages.shift() });
    return Response.json({ success: true, result: true });
  }) as typeof fetch);
  const signal = new AbortController().signal;
  assert.deepEqual(await client.devices(signal), [{ id: 'synthetic-ac-0001', name: 'Ar da sala', model: 'Wi-Fi air conditioner' }]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://openapi.tuyaus.com/v1.0/token?grant_type=1');
  assert.equal(calls[1].url, 'https://openapi.tuyaus.com/v1.0/iot-01/associated-users/devices?size=50');
  assert.equal(calls[2].url, 'https://openapi.tuyaus.com/v1.0/iot-01/associated-users/devices?last_row_key=PAGE-TWO&size=50');
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const hmac = (s: string) => createHmac('sha256', project.accessSecret).update(s).digest('hex').toUpperCase();
  const tokenHeaders = calls[0].init.headers as Record<string, string>;
  assert.equal(tokenHeaders.client_id, project.accessId);
  assert.equal(tokenHeaders.sign_method, 'HMAC-SHA256');
  assert.equal(tokenHeaders.access_token, undefined);
  assert.equal(tokenHeaders.sign, hmac(project.accessId + tokenHeaders.t + ['GET', sha(''), '', '/v1.0/token?grant_type=1'].join('\n')));
  const listHeaders = calls[1].init.headers as Record<string, string>;
  assert.equal(listHeaders.access_token, 'synthetic-token');
  assert.match(listHeaders.sign, /^[0-9A-F]{64}$/);
  assert.equal(calls[0].init.redirect, 'error');
  await client.send('id/with?special', { code: 'temp_set', value: 230 }, signal);
  const post = calls.at(-1)!;
  assert.equal(post.url, 'https://openapi.tuyaus.com/v1.0/iot-03/devices/id%2Fwith%3Fspecial/commands');
  assert.equal(post.init.method, 'POST');
  assert.equal((post.init.headers as Record<string, string>)['Content-Type'], 'application/json');
  const body = JSON.stringify({ commands: [{ code: 'temp_set', value: 230 }] });
  assert.equal(post.init.body, body);
  const stringToSign = ['POST', sha(body), '', '/v1.0/iot-03/devices/id%2Fwith%3Fspecial/commands'].join('\n');
  assert.equal((post.init.headers as Record<string, string>).sign, hmac(project.accessId + 'synthetic-token' + (post.init.headers as Record<string, string>).t + stringToSign));
});

test('HTTP: perfil usa funções e especificações e a leitura mantém a escala do aparelho', async () => {
  const routes: string[] = [];
  const client = new ElginClient(project, (async url => {
    routes.push(String(url));
    const u = String(url);
    if (u.endsWith('/v1.0/token?grant_type=1')) return Response.json({ success: true, result: { access_token: 'synthetic-token' } });
    if (u.includes('/functions')) return Response.json({ success: true, result: functionsFixture });
    if (u.includes('/specifications')) return Response.json({ success: true, result: specificationsFixture });
    return Response.json({ success: true, result: statusFixture });
  }) as typeof fetch);
  const signal = new AbortController().signal;
  assert.deepEqual(await client.profile('synthetic-ac', signal), caps);
  const parsed = await client.state('synthetic-ac', signal);
  assert.equal(parsed.current, 25); assert.equal(parsed.target, 24);
  assert.ok(routes.some(r => r.includes('/v1.1/devices/synthetic-ac/specifications')));
  assert.ok(routes.some(r => r.includes('/v1.0/iot-03/devices/synthetic-ac/status')));
});

test('HTTP: erros mapeados e sem vazamento de credenciais ou payload cru', async () => {
  const withToken = (body: unknown, status = 200) => new ElginClient(project, (async url => String(url).includes('/v1.0/token')
    ? Response.json({ success: true, result: { access_token: 'synthetic-token' } })
    : Response.json(body, { status })) as typeof fetch);
  for (const [body, expected] of [
    [{ success: false, code: '1004', msg: project.accessSecret }, /Credenciais/],
    [{ success: false, code: '2009' }, /Credenciais/],
    [{ success: false, code: '1106' }, /vinculada/],
    [{ success: false, code: '2406' }, /região/],
    [{ success: false, code: '28841105' }, /serviços/],
    [{ success: false, code: '28841107' }, /datacenter/],
    [{ success: false, code: '99999999' }, /recusou/],
  ] as const) {
    await assert.rejects(withToken(body).devices(new AbortController().signal), expected);
  }
  await assert.rejects(withToken({ success: false }, 429).devices(new AbortController().signal), /Limite de pedidos/);
  await assert.rejects(withToken({ success: false }, 503).devices(new AbortController().signal), /indisponíveis/);
  const leak = withToken({ success: false, code: '1004', msg: project.accessSecret });
  await assert.rejects(leak.devices(new AbortController().signal), error => error instanceof Error && !error.message.includes(project.accessSecret));
  const offline = new ElginClient(project, (async () => { throw new Error(project.accessSecret); }) as typeof fetch);
  await assert.rejects(offline.devices(new AbortController().signal), error => error instanceof Error && !error.message.includes(project.accessSecret) && /Não foi possível acessar a Tuya/.test(error.message));
});

test('token expirado é renovado uma única vez e a chamada é repetida; persistir não repete sem fim', async () => {
  let tokens = 0, deviceCalls = 0;
  const client = new ElginClient(project, (async url => {
    if (String(url).includes('/v1.0/token')) { tokens++; return Response.json({ success: true, result: { access_token: `token-${tokens}` } }); }
    deviceCalls++;
    return deviceCalls === 1 ? Response.json({ success: false, code: '1010' }) : Response.json({ success: true, result: { devices: [], has_more: false } });
  }) as typeof fetch);
  assert.deepEqual(await client.devices(new AbortController().signal), []);
  assert.equal(tokens, 2); assert.equal(deviceCalls, 2);
  const always = new ElginClient(project, (async url => String(url).includes('/v1.0/token')
    ? Response.json({ success: true, result: { access_token: 'token' } })
    : Response.json({ success: false, code: '1010' })) as typeof fetch);
  await assert.rejects(always.devices(new AbortController().signal), /expirou/);
});

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup(overrides: Partial<ElginTransport> = {}, initial: ElginCredentials | null = null) {
  let saved: ElginCredentials | null = initial;
  const transport: ElginTransport = { devices: async () => [device, { ...device, id: 'second' }], profile: async () => caps, state: async () => ({ ...state }), send: async () => {}, ...overrides };
  // Push dublê: os testes de núcleo não abrem soquete real (o push tem suíte
  // própria em elgin-push.test.ts).
  const session = new ElginSession({ read: () => saved, write: value => { saved = { ...value }; }, clear: () => { saved = null; } }, () => {}, () => transport, async () => {}, () => ({ start: () => {}, stop: () => {} }));
  return { session, saved: () => saved };
}

test('conexão valida o projeto, salva credenciais e publica aparelhos, capacidades e estado', async () => {
  const { session, saved } = setup();
  const invalid = await session.connect({ accessId: 'curto', accessSecret: 'x', region: 'us' });
  assert.match(invalid.error ?? '', /Access ID/);
  const region = await session.connect({ ...project, region: 'marte' });
  assert.match(region.error ?? '', /região/);
  const result = await session.connect(project);
  assert.equal(result.connected, true); assert.equal(result.selectedId, 'synthetic-ac');
  assert.deepEqual(result.devices.map(d => d.id), ['synthetic-ac', 'second']);
  assert.deepEqual(result.capabilities, caps); assert.equal(result.state?.power, true);
  assert.deepEqual(saved(), { ...project, selectedId: 'synthetic-ac' });
  session.dispose();
});

test('restore reconecta com as credenciais salvas e mantém o aparelho escolhido', async () => {
  const { session, saved } = setup({}, { ...project, selectedId: 'second' });
  await session.restore();
  assert.equal(session.get().connected, true); assert.equal(session.get().selectedId, 'second');
  assert.deepEqual(saved(), { ...project, selectedId: 'second' });
  session.dispose();
});

test('desconectar durante a descoberta não salva credenciais nem ressuscita a sessão', async () => {
  const pending = deferred<ElginDevice[]>();
  const { session, saved } = setup({ devices: () => pending.promise });
  const connecting = session.connect(project);
  session.disconnect(); pending.resolve([device]); await connecting;
  assert.equal(saved(), null); assert.equal(session.get().connected, false);
  session.dispose();
});

test('leituras antigas são descartadas ao trocar de aparelho e o segredo nunca entra no snapshot', async () => {
  const pending = deferred<ElginState>();
  let slow = false;
  const { session } = setup({ state: async id => slow && id === 'synthetic-ac' ? pending.promise : { ...state, target: id === 'second' ? 25 : 18 } });
  await session.connect(project); slow = true;
  const reading = session.refresh(); await session.select('second'); pending.resolve({ ...state, target: 19 }); await reading;
  assert.equal(session.get().selectedId, 'second'); assert.equal(session.get().state?.target, 25);
  assert.equal(JSON.stringify(session.get()).includes(project.accessSecret), false);
  session.dispose();
});

test('comandos usam o estado confirmado, rejeitam envio concorrente e não repetem POST ambíguo', async () => {
  const pending = deferred<void>(); let sends = 0;
  const { session } = setup({ send: async () => { sends++; await pending.promise; throw new Error('timeout'); } });
  await session.connect(project);
  const sending = session.command('synthetic-ac', { field: 'power', value: false });
  assert.equal(session.get().state?.power, true);
  await session.command('synthetic-ac', { field: 'power', value: false });
  pending.resolve(); await sending;
  assert.equal(sends, 1); assert.ok(session.get().error); assert.equal(session.get().state?.power, true);
  session.dispose();
});

test('comando confirmado atualiza o estado depois da leitura, sem alteração otimista', async () => {
  const pending = deferred<void>(); let power = true;
  const { session } = setup({ send: () => pending.promise, state: async () => ({ ...state, power }) });
  await session.connect(project);
  const sending = session.command('synthetic-ac', { field: 'power', value: false });
  assert.equal(session.get().state?.power, true);
  power = false; pending.resolve(); await sending;
  const result = session.get();
  assert.equal(result.state?.power, false); assert.equal(result.notice, null); assert.equal(result.error, null); assert.equal(result.busy, false);
  session.dispose();
});

test('comando não anunciado é rejeitado sem enviar nada', async () => {
  let sends = 0;
  const { session } = setup({ profile: async () => ({ ...caps, light: false }), send: async () => { sends++; } });
  await session.connect(project);
  await session.command('synthetic-ac', { field: 'light', value: true });
  assert.equal(sends, 0); assert.match(session.get().error ?? '', /não é suportado/);
  session.dispose();
});

test('desconectar durante o comando descarta o resultado tardio e limpa as credenciais', async () => {
  const pending = deferred<void>();
  const { session, saved } = setup({ send: () => pending.promise });
  await session.connect(project); const sending = session.command('synthetic-ac', { field: 'power', value: false });
  session.disconnect(); pending.resolve(); await sending;
  assert.equal(saved(), null); assert.equal(session.get().state, null); assert.equal(session.get().connected, false);
  session.dispose();
});

test('abrir o painel consulta na hora quando a última leitura está velha', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let reads = 0;
  const { session } = setup({ state: async () => { reads++; return { ...state }; } });
  await session.connect(project);
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
