#!/usr/bin/env node
/**
 * Sonda de consumo — Tuya Cloud (GlacialPoint · analytics)
 *
 * Investiga o que a nuvem Tuya expõe sobre consumo do ar (categoria kt):
 *   1. Modelo de dados (/v2.0/cloud/thing/{id}/model) — nome, descrição e
 *      typeSpec de cada DP; é onde produtos Tuya documentam o fator do
 *      contador de kWh (ex.: "valor reportado × 0,03125 = kWh");
 *   2. Status atual — DPs candidatos a energia;
 *   3. Estatísticas de DP (legado): all-statistic-type · total · dias · meses;
 *   4. Módulo de energia (/v1.0/m/energy/statistics/device/datadate);
 *   5. Estimativa de consumo pelo histórico de liga/desliga (mesma conta do
 *      app: logs de switch da janela gratuita × fator configurável).
 *
 * Uso:
 *   node scripts/tuya-energy.mjs
 *
 * Variáveis: TUYA_CONFIG · TUYA_DEVICE (id ou trecho do nome) ·
 *            TUYA_PROBE_FULL=1 (não mascarar ids) ·
 *            TUYA_HISTORY_DAYS (padrão 30) · TUYA_HISTORY_MONTHS (padrão 6)
 *
 * Credenciais: ~/.config/glacialpoint/tuya.json (600) — nunca no repositório.
 * Segurança: não imprime Access ID/Secret; ids mascarados por padrão.
 */

import { loadConfig, createClient, mask, printHints } from "./tuya-lib.mjs";

const { cfg, host } = loadConfig();
const client = createClient(cfg, host);
const api = (method, path, opts) => client.request(method, path, opts);

/** Códigos que cheiram a energia/consumo. */
const ENERGY_RE = /energy|consum|add_ele|ele_usage|^power/;
const isEnergyCode = (code) => ENERGY_RE.test(String(code ?? ""));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Data no fuso do usuário, como a nuvem espera: YYYYMMDD · YYYYMM · YYYYMMDDHH. */
function stamp(date, kind = "day") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(kind === "hour" ? { hour: "2-digit", hourCycle: "h23" } : {}),
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const s = get("year") + get("month") + get("day");
  return kind === "hour" ? s + get("hour") : s;
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function step(label, fn) {
  try {
    const value = await fn();
    console.log(value === undefined ? `  ✓ ${label}` : `  ✓ ${label}: ${value}`);
    return value;
  } catch (e) {
    console.log(`  ✗ ${label}: ${e.message}`);
    return null;
  }
}

async function findAc() {
  const want = process.env.TUYA_DEVICE;
  const listed = [];
  let lastRowKey;
  for (let page = 0; page < 10; page++) {
    const q = { size: 50 };
    if (lastRowKey) q.last_row_key = lastRowKey;
    const r = await api("GET", "/v1.0/iot-01/associated-users/devices", { query: q });
    listed.push(...(r.devices ?? r.list ?? []));
    if (!r.has_more) break;
    lastRowKey = r.last_row_key;
  }
  const candidates = want ? listed.filter((d) => d.id === want || d.name.includes(want)) : listed.filter((d) => d.category === "kt");
  if (!candidates.length) throw new Error(want ? `nenhum aparelho bate com TUYA_DEVICE="${want}"` : "nenhum ar-condicionado (categoria kt) no projeto");
  return candidates[0];
}

/** DPs de energia presentes no modelo de dados, com descrição/typeSpec. */
async function printModel(deviceId) {
  const r = await api("GET", `/v2.0/cloud/thing/${deviceId}/model`);
  const model = JSON.parse(r.model ?? "{}");
  const props = (model.services ?? []).flatMap((s) => s.properties ?? []);
  const energy = props.filter((p) => isEnergyCode(p.code));
  if (!energy.length) {
    console.log("  (nenhum DP de energia no modelo)");
    return;
  }
  for (const p of energy) {
    console.log(`  · ${p.code} (id ${p.abilityId}) — ${p.name ?? ""} [${p.accessMode ?? "?"}]`);
    if (p.description) console.log(`      descrição: ${String(p.description).replaceAll("\n", " ⏎ ")}`);
    console.log(`      typeSpec: ${JSON.stringify(p.typeSpec)}`);
  }
}

/** Estatísticas de um DP: total, dias e meses. */
async function printStats(deviceId, code) {
  const historyDays = Number(process.env.TUYA_HISTORY_DAYS ?? 30);
  const historyMonths = Number(process.env.TUYA_HISTORY_MONTHS ?? 6);

  await step(`all-statistic-type [${code}]`, async () => {
    const r = await api("GET", `/v1.0/devices/${deviceId}/all-statistic-type`, { query: { code } });
    return JSON.stringify(r);
  });

  await step(`total [${code}]`, async () => {
    const r = await api("GET", `/v1.0/devices/${deviceId}/statistics/total`, { query: { code } });
    return JSON.stringify(r);
  });

  await step(`dias [${code}] (sum, últimos ${historyDays})`, async () => {
    const r = await api("GET", `/v1.0/devices/${deviceId}/statistics/days`, {
      query: {
        code,
        start_day: stamp(daysAgo(historyDays), "day"),
        end_day: stamp(new Date(), "day"),
        stat_type: "sum",
      },
    });
    const days = r?.days ?? {};
    const entries = Object.entries(days);
    const positive = entries.filter(([, v]) => Number(v) > 0);
    console.log(`      ${entries.length} dia(s); ${positive.length} com valor > 0`);
    for (const [d, v] of positive.slice(-10)) console.log(`      ${d} = ${v}`);
    const total = entries.reduce((acc, [, v]) => acc + Number(v), 0);
    console.log(`      soma do período: ${total.toFixed(3)} (unidade do DP)`);
    return undefined;
  });

  await step(`meses [${code}] (sum, últimos ${historyMonths})`, async () => {
    const r = await api("GET", `/v1.0/devices/${deviceId}/statistics/months`, {
      query: {
        code,
        start_month: stamp(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (historyMonths - 1), 1)), "month").slice(0, 6),
        end_month: stamp(new Date(), "month").slice(0, 6),
      },
    });
    return JSON.stringify(r?.months ?? {});
  });
}

/** Módulo de energia: tenta a série temporal do indicador (doc usa ele_usage). */
async function tryEnergyModule(deviceId, indicatorCode) {
  const range = { begin: stamp(daysAgo(7), "day"), end: stamp(new Date(), "day") };
  await step(`m/energy datadate [${indicatorCode}] (body snake_case)`, async () => {
    const r = await api("POST", "/v1.0/m/energy/statistics/device/datadate", {
      body: {
        dev_id: deviceId,
        indicator_code: indicatorCode,
        date_type: "day",
        begin_date: range.begin,
        end_date: range.end,
        aggregation_type: "SUM",
      },
    });
    const list = r?.list ?? [];
    return `${list.length} ponto(s), unidade ${r?.unit ?? "?"}${list.length ? ` — último: ${JSON.stringify(list.at(-1))}` : ""}`;
  });
  await step(`m/energy datadate [${indicatorCode}] (query camelCase, como o exemplo da doc)`, async () => {
    const r = await api("POST", "/v1.0/m/energy/statistics/device/datadate", {
      query: { devId: deviceId, indicatorCode, dateType: "day", beginDate: range.begin, endDate: range.end },
    });
    const list = r?.list ?? [];
    return `${list.length} ponto(s), unidade ${r?.unit ?? "?"}${list.length ? ` — último: ${JSON.stringify(list.at(-1))}` : ""}`;
  });
}

const fmtLog = (l) => `${new Date(Number(l.event_time)).toISOString()} ${l.code}=${JSON.stringify(l.value)} (evento ${l.event_id})`;

/** Estimativa de consumo pelo liga/desliga — mesma conta do app (tempo × fator). */
async function tryEstimate(deviceId, factor = 0.7) {
  const dayMs = 86400000;
  const zone = "America/Sao_Paulo";
  const stamps = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const dayOf = (t) => stamps.format(new Date(t)).replaceAll("-", "");
  const dayStart = (t) => {
    const list = parts.formatToParts(new Date(t));
    const get = (type) => Number(list.find((p) => p.type === type).value);
    const offset = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(t / 1000) * 1000;
    return Math.floor((t + offset) / dayMs) * dayMs - offset;
  };
  const now = Date.now(), from = dayStart(now) - 6 * dayMs;
  const events = [];
  let rowKey;
  for (let page = 0; page < 10; page++) {
    const query = { type: 7, size: 100, start_time: from, end_time: now, codes: "switch" };
    if (rowKey) query.start_row_key = rowKey;
    const r = await api("GET", `/v1.0/devices/${deviceId}/logs`, { query });
    for (const l of r?.logs ?? []) {
      const on = l.value === true || l.value === "true" || l.value === 1 || l.value === "1";
      const off = l.value === false || l.value === "false" || l.value === 0 || l.value === "0";
      if (on || off) events.push({ time: Number(l.event_time), on });
    }
    console.log(`      página ${page + 1}: ${(r?.logs ?? []).length} registro(s), has_next=${r?.has_next}`);
    if (r?.has_next !== true || !r?.next_row_key || r.next_row_key === rowKey) break;
    rowKey = r.next_row_key;
  }
  events.sort((a, b) => a.time - b.time);
  const seconds = new Map();
  for (let cursor = dayStart(from); cursor < now; cursor += dayMs) seconds.set(dayOf(cursor), 0);
  let open = null;
  const intervals = [];
  for (const event of events) {
    if (event.on) { if (open === null) open = event.time; }
    else if (open !== null) { if (event.time > open) intervals.push([open, event.time]); open = null; }
  }
  const status = await api("GET", `/v1.0/iot-03/devices/${deviceId}/status`);
  const power = status.find((dp) => dp.code === "switch")?.value;
  if (open !== null && power === true && now > open) intervals.push([open, now]);
  for (const [start, end] of intervals) {
    let cursor = Math.max(start, from);
    const stop = Math.min(end, now);
    while (cursor < stop) {
      const slice = Math.min(stop, dayStart(cursor) + dayMs);
      const day = dayOf(cursor);
      seconds.set(day, (seconds.get(day) ?? 0) + (slice - cursor) / 1000);
      cursor = slice;
    }
  }
  const round = (v) => Math.round(v * 1000) / 1000;
  console.log(`      ${events.length} evento(s) de liga/desliga; fator ${factor} kWh/h; estado atual: ${power === true ? "ligado" : "desligado"}`);
  let total = 0;
  for (const [day, s] of [...seconds].sort()) {
    total += s;
    console.log(`      ${day}: ${(s / 3600).toFixed(2)} h ligado ≈ ${round((s / 3600) * factor)} kWh`);
  }
  console.log(`      janela: ${(total / 3600).toFixed(2)} h ≈ ${round((total / 3600) * factor)} kWh`);
}

/** Logs de DP (histórico de reportes) — útil quando não há estatística agregada. */
async function tryLogs(deviceId, code) {
  const rotulo = code ? `logs [${code}]` : "logs [sem filtro]";
  await step(`${rotulo} (type=7, últimos 7 dias, tamanho 100)`, async () => {
    const query = {
      type: 7,
      start_time: 0, // 0 = a nuvem usa os últimos 7 dias
      end_time: Date.now(),
      size: 100,
    };
    if (code) query.codes = code;
    const r = await api("GET", `/v1.0/devices/${deviceId}/logs`, { query });
    const logs = r?.logs ?? [];
    if (code) {
      const comValor = logs.filter((l) => Number(l.value) !== 0);
      console.log(`      ${logs.length} registro(s); ${comValor.length} ≠ 0`);
      for (const l of logs.slice(0, 3)) console.log(`      ${fmtLog(l)}`);
      return undefined;
    }
    const byCode = new Map();
    for (const l of logs) {
      const info = byCode.get(l.code) ?? { total: 0, naoZero: 0, ultimo: null };
      info.total++;
      if (Number(l.value) !== 0) info.naoZero++;
      info.ultimo = l;
      byCode.set(l.code, info);
    }
    console.log(`      ${logs.length} registro(s) no total, ${byCode.size} código(s):`);
    for (const [c, info] of [...byCode].sort((a, b) => b[1].total - a[1].total)) {
      console.log(`      ${c}: ${info.total} reporte(s), ${info.naoZero} ≠ 0 — último: ${fmtLog(info.ultimo)}`);
    }
    if (!logs.length) console.log("      (nenhum reporte de DP no período)");
    return undefined;
  });
}

try {
  console.log(`Datacenter: ${cfg.region} → ${host}`);
  const tk = await client.refresh();
  console.log(`Autenticação: ok (token válido por ${tk.expire_time}s)`);

  const dev = await findAc();
  console.log(`Aparelho: ${dev.name} · ${dev.category} · ${dev.online ? "online" : "offline"} (${mask(dev.id)})\n`);

  console.log("== Modelo de dados (descrições de energia) ==");
  await step("modelo", async () => {
    await printModel(dev.id);
    return undefined;
  });

  console.log("\n== Status atual (DPS de energia) ==");
  const status = await api("GET", `/v1.0/iot-03/devices/${dev.id}/status`);
  const energyDps = status.filter((dp) => isEnergyCode(dp.code));
  if (!energyDps.length) console.log("  (nenhum DP de energia no status)");
  for (const dp of energyDps) console.log(`  ${dp.code} = ${JSON.stringify(dp.value)}`);
  console.log(`  (status completo: ${status.length} DPs)`);

  const codes = [...new Set(energyDps.map((dp) => dp.code))];
  if (!codes.length) codes.push("power_consumption"); // melhor palpite p/ estatística

  for (const code of codes) {
    console.log(`\n== Estatísticas do DP ${code} ==`);
    await printStats(dev.id, code);
  }

  console.log("\n== Módulo de energia (/v1.0/m/energy) ==");
  for (const indicator of ["ele_usage"]) {
    await tryEnergyModule(dev.id, indicator);
    await sleep(300);
  }

  console.log("\n== Logs de reporte (histórico bruto) ==");
  await tryLogs(dev.id);
  await sleep(300);

  console.log("\n== Estimativa por liga/desliga (mesma conta do app) ==");
  await step("estimativa (janela de 7 dias)", async () => {
    await tryEstimate(dev.id);
    return undefined;
  });
} catch (e) {
  console.error(`\nFalhou: ${e.message}`);
  if (e.path) console.error(`Endpoint: ${e.path}`);
  printHints(e);
  process.exitCode = 1;
}
