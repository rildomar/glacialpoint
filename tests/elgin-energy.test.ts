import test from 'node:test';
import assert from 'node:assert/strict';
import functionsFixture from './fixtures/elgin-functions.json';
import statusFixture from './fixtures/elgin-status.json';
import { capabilities, ElginClient, parseState, type ElginLogEntry, type ElginTransport } from '../electron/core/elgin-client';
import { ElginSession, type ElginCredentials } from '../electron/core/elgin-session';
import { buildEstimate, dayOf, dayStart, mergeUsage, switchEvents, usageByDay } from '../electron/core/elgin-energy';
import type { ElginDevice, ElginProject } from '../shared/elgin';

// Fixtures sintéticas, como nos testes do núcleo (marco F). Segredos são fictícios.
const project: ElginProject = { accessId: 'synthetic-access-id-01', accessSecret: 'synthetic-secret-value-0001', region: 'us' };
const caps = capabilities(functionsFixture.functions);
const state = parseState(statusFixture);
const device: ElginDevice = { id: 'synthetic-ac', name: 'Teste', model: 'Elgin' };

test('estimativa: períodos de liga/desliga são cortados no meio da noite local', () => {
  const on = Date.UTC(2026, 9, 16, 2, 0, 0); // 15/10 23:00 em São Paulo
  const off = Date.UTC(2026, 9, 16, 4, 0, 0); // 16/10 01:00
  const from = Date.UTC(2026, 9, 14, 3, 0, 0); // 14/10 00:00 local
  const days = usageByDay([{ time: on, on: true }, { time: off, on: false }], { from, to: off, currentPower: false });
  assert.equal(days.get('20261014'), 0);
  assert.equal(days.get('20261015'), 3600);
  assert.equal(days.get('20261016'), 3600);
});

test('estimativa: período aberto só fecha em agora com o aparelho ligado', () => {
  const from = Date.UTC(2026, 9, 16, 3, 0, 0), on = Date.UTC(2026, 9, 16, 15, 0, 0), to = Date.UTC(2026, 9, 16, 17, 0, 0);
  assert.equal(usageByDay([{ time: on, on: true }, { time: on + 1000, on: true }], { from, to, currentPower: true }).get('20261016'), 7200);
  assert.equal(usageByDay([{ time: on, on: true }], { from, to, currentPower: false }).get('20261016'), 0);
  assert.equal(usageByDay([{ time: on, on: true }], { from, to, currentPower: null }).get('20261016'), 0);
});

test('estimativa: eventos de switch aceitam booleano e texto e ignoram valores estranhos', () => {
  const events = switchEvents([
    { code: 'temp_current', value: 250, time: 1 },
    { code: 'switch', value: 'true', time: 2 },
    { code: 'switch', value: 0, time: 3 },
    { code: 'switch', value: '???', time: 4 },
    { code: 'switch', value: true, time: 5 },
  ]);
  assert.deepEqual(events, [{ time: 2, on: true }, { time: 3, on: false }, { time: 5, on: true }]);
});

test('estimativa: a janela de logs é autoritativa e os dias antigos ficam congelados', () => {
  const merged = mergeUsage({ '20261010': 60, '20261015': 7200 }, new Map([['20261015', 3600], ['20261016', 0]]));
  assert.deepEqual(merged, { '20261010': 60, '20261015': 3600, '20261016': 0 });
});

test('estimativa: relatório usa períodos locais, consumo médio e marca a origem', () => {
  const now = Date.UTC(2026, 9, 17, 15, 0, 0); // 17/10 12:00 local
  const report = buildEstimate('synthetic-ac', { '20260930': 3600, '20261016': 7200, '20261017': 1800 }, 0.7, now);
  assert.equal(report.source, 'estimate');
  assert.equal(report.supported, true);
  assert.equal(report.error, null);
  assert.equal(report.updatedAt, now);
  assert.equal(report.daily.length, 30);
  assert.equal(report.monthly.length, 6);
  const byDate = new Map(report.daily.map(point => [point.date, point.kwh]));
  assert.equal(byDate.get('20261016'), 1.4);
  assert.equal(byDate.get('20260930'), 0.7);
  assert.equal(byDate.get('20260929'), null);
  assert.equal(byDate.get('20261017'), undefined); // o dia corrente fica fora do gráfico diário
  const byMonth = new Map(report.monthly.map(point => [point.date, point.kwh]));
  assert.equal(byMonth.get('202610'), 1.75);
  assert.equal(byMonth.get('202609'), 0.7);
  assert.equal(byMonth.get('202605'), null);
});

test('HTTP: logs de DP paginam por start_row_key e parseiam código, valor e horário', async () => {
  const calls: string[] = [];
  const client = new ElginClient(project, (async url => {
    const target = String(url); calls.push(target);
    if (target.includes('/v1.0/token')) return Response.json({ success: true, result: { access_token: 'synthetic-token' } });
    if (target.includes('start_row_key=PAGE-TWO')) return Response.json({ success: true, result: { logs: [{ code: 'switch', value: 'false', event_time: 3000 }], has_next: false } });
    return Response.json({ success: true, result: { logs: [{ code: 'switch', value: 'true', event_time: 1000 }, { code: 'temp_current', value: 250, event_time: 2000 }], has_next: true, next_row_key: 'PAGE-TWO' } });
  }) as typeof fetch);
  const entries = await client.logs('synthetic-ac', { start: 0, end: 9999, codes: 'switch' }, new AbortController().signal);
  assert.deepEqual(entries, [
    { code: 'switch', value: 'true', time: 1000 },
    { code: 'temp_current', value: 250, time: 2000 },
    { code: 'switch', value: 'false', time: 3000 },
  ]);
  assert.match(calls[1], /\/v1\.0\/devices\/synthetic-ac\/logs\?/);
  assert.match(calls[1], /codes=switch/);
  assert.match(calls[1], /type=7/);
  assert.match(calls[2], /start_row_key=PAGE-TWO/);
});

function setup(overrides: Partial<ElginTransport> = {}) {
  let saved: ElginCredentials | null = null;
  let stored: Record<string, number> = {};
  const transport: ElginTransport = { devices: async () => [device], profile: async () => caps, state: async () => ({ ...state }), send: async () => {}, ...overrides };
  const session = new ElginSession(
    { read: () => saved, write: value => { saved = { ...value }; }, clear: () => { saved = null; } },
    () => {}, () => transport, async () => {}, undefined,
    { read: () => ({ ...stored }), write: days => { stored = { ...days }; } },
  );
  return { session, stored: () => stored };
}

test('sessão: energia usa os logs, congela o acumulado e reusa o resultado por 5 minutos', async () => {
  const on = dayStart(Date.now()) - 20 * 3600_000; // ontem 04:00 local
  const off = on + 2 * 3600_000;
  let calls = 0;
  const { session, stored } = setup({ logs: async () => { calls += 1; return [
    { code: 'switch', value: 'true', time: on },
    { code: 'switch', value: 'true', time: on + 1000 },
    { code: 'switch', value: 'false', time: off },
  ]; } });
  await session.connect(project);
  const first = await session.energy('synthetic-ac', 0.5);
  assert.equal(first.error, null);
  assert.equal(first.source, 'estimate');
  assert.equal(stored()[dayOf(off)], 7200);
  assert.equal(Object.keys(stored()).length, 7); // 7 dias cobertos, com ou sem uso
  assert.equal(first.daily.find(point => point.date === dayOf(off))?.kwh, 1);
  assert.equal(first.daily.filter(point => point.kwh !== null).length, 6);
  const cached = await session.energy('synthetic-ac', 1);
  assert.equal(calls, 1);
  assert.equal(cached.daily.find(point => point.date === dayOf(off))?.kwh, 2);
  assert.match((await session.energy('outro-aparelho')).error ?? '', /Selecione um aparelho/);
  session.dispose();
});

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

test('sessão: desconectar durante a consulta descarta o resultado tardio', async () => {
  const pending = deferred<ElginLogEntry[]>();
  const { session } = setup({ logs: () => pending.promise });
  await session.connect(project);
  const reading = session.energy('synthetic-ac');
  session.disconnect();
  pending.resolve([]);
  assert.match((await reading).error ?? '', /A sessão mudou/);
  session.dispose();
});

test('sessão: sem o serviço de logs a estimativa falha com mensagem clara', async () => {
  const { session } = setup();
  await session.connect(project);
  const report = await session.energy('synthetic-ac');
  assert.match(report.error ?? '', /Selecione um aparelho/);
  session.dispose();
});
