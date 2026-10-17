#!/usr/bin/env node
/**
 * Controle — Tuya Cloud (GlacialPoint · marco F · caminho B)
 *
 * Envia comandos reais a um ar-condicionado do projeto
 * (POST /v1.0/iot-03/devices/{id}/commands) e acompanha o status na nuvem
 * até refletir a mudança (ou desistir após 10 s).
 *
 * Uso:
 *   node scripts/tuya-control.mjs status
 *   node scripts/tuya-control.mjs set <código> <valor>
 *
 * Exemplos:
 *   node scripts/tuya-control.mjs set switch false
 *   node scripts/tuya-control.mjs set mode cold          # cold · hot · wet · wind · auto
 *   node scripts/tuya-control.mjs set temp_set 23        # em °C — a escala do aparelho é aplicada sozinha
 *   node scripts/tuya-control.mjs set light true
 *
 * Credenciais: igual à sonda (~/.config/glacialpoint/tuya.json, permissão 600).
 * Variáveis: TUYA_CONFIG (caminho das credenciais) · TUYA_DEVICE (id ou trecho
 * do nome; padrão: primeiro aparelho de categoria "kt") · TUYA_PROBE_FULL=1
 * (não mascarar ids).
 *
 * Segurança: não imprime Access ID/Secret; ids mascarados por padrão.
 */

import { loadConfig, createClient, mask, printHints } from "./tuya-lib.mjs";

const USAGE = `Uso:
  node scripts/tuya-control.mjs status
  node scripts/tuya-control.mjs set <código> <valor>

Exemplos:
  node scripts/tuya-control.mjs set switch false
  node scripts/tuya-control.mjs set mode cold          # cold · hot · wet · wind · auto
  node scripts/tuya-control.mjs set temp_set 23        # em °C — a escala do aparelho é aplicada sozinha
  node scripts/tuya-control.mjs set light true

Variáveis: TUYA_CONFIG (credenciais) · TUYA_DEVICE (id ou trecho do nome) ·
           TUYA_PROBE_FULL=1 (não mascarar ids)`;

const [cmd, argCode, argValue] = process.argv.slice(2);
if ((cmd !== "status" && cmd !== "set") || (cmd === "set" && (argCode === undefined || argValue === undefined))) {
  console.error(USAGE);
  process.exit(1);
}

const { cfg, host } = loadConfig();
const client = createClient(cfg, host);
const api = (method, path, opts) => client.request(method, path, opts);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const candidates = want
    ? listed.filter((d) => d.id === want || d.name.includes(want))
    : listed.filter((d) => d.category === "kt");
  if (!candidates.length) {
    throw new Error(
      want
        ? `nenhum aparelho bate com TUYA_DEVICE="${want}"`
        : "nenhum ar-condicionado (categoria kt) no projeto"
    );
  }
  return candidates[0];
}

const getStatus = (id) => api("GET", `/v1.0/iot-03/devices/${id}/status`);

async function getFunctions(id) {
  const r = await api("GET", `/v1.0/iot-03/devices/${id}/functions`);
  return Array.isArray(r) ? r : r?.functions ?? [];
}

/** Especificação por código: { scale, min, max } (para escalar temperatura etc.). */
async function getSpecs(id) {
  const specs = {};
  try {
    const r = await api("GET", `/v1.1/devices/${id}/specifications`);
    const list = Array.isArray(r) ? r : r?.functions ?? [];
    for (const f of list) {
      try {
        const v = JSON.parse(f.values ?? "{}");
        specs[f.code] = { scale: v.scale, min: v.min, max: v.max };
      } catch {
        // values não é JSON — ignora
      }
    }
  } catch {
    // sem especificação: segue sem escala/faixa
  }
  return specs;
}

const scaleOf = (code, specs) => specs[code]?.scale ?? (code.startsWith("temp") ? 1 : 0);

function pretty(code, value, specs) {
  if (typeof value === "number" && code.startsWith("temp")) {
    return `${value / 10 ** scaleOf(code, specs)} °C (${value})`;
  }
  return JSON.stringify(value);
}

function coerce(fn, raw, specs) {
  if (fn.type === "Boolean") {
    const map = { true: true, false: false, "1": true, "0": false, on: true, off: false };
    const v = map[String(raw).toLowerCase()];
    if (v === undefined) throw new Error(`valor booleano inválido: "${raw}" (use true/false)`);
    return v;
  }

  if (fn.type === "Enum") {
    let values = [];
    try {
      const parsed = JSON.parse(fn.values ?? "[]");
      values = Array.isArray(parsed) ? parsed : parsed?.range ?? [];
    } catch {
      // values não é lista — não valida
    }
    if (values.length && !values.includes(raw)) {
      throw new Error(`valor inválido para ${fn.code}: "${raw}" (opções: ${values.join(", ")})`);
    }
    return raw;
  }

  if (fn.type === "Integer") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`valor numérico inválido: "${raw}"`);
    const { scale = 0, min, max } = specs[fn.code] ?? {};
    const value = Math.round(n * 10 ** scale);
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      const h = (x) => x / 10 ** scale;
      throw new Error(
        `${fn.code} = ${n} → ${value} fora da faixa do aparelho (${min}–${max} = ${h(min)}–${h(max)}). ` +
          `Em códigos de temperatura informe °C (ex.: 23).`
      );
    }
    return value;
  }

  return raw;
}

try {
  console.log(`Datacenter: ${cfg.region} → ${host}`);
  const tk = await client.refresh();
  console.log(`Autenticação: ok (token válido por ${tk.expire_time}s)`);

  const dev = await findAc();
  console.log(`Aparelho: ${dev.name} · ${dev.category} · ${dev.online ? "online" : "offline"} (${mask(dev.id)})`);

  const specs = await getSpecs(dev.id);
  const status = await getStatus(dev.id);
  console.log("\nStatus:");
  for (const dp of status) console.log(`  ${dp.code} = ${pretty(dp.code, dp.value, specs)}`);

  if (cmd === "set") {
    const fns = await getFunctions(dev.id);
    const fn = fns.find((f) => f.code === argCode);
    if (!fn) {
      console.error(`\nCódigo "${argCode}" não é aceito pelo aparelho.`);
      console.error(`Disponíveis: ${fns.map((f) => f.code).join(", ")}`);
      process.exit(1);
    }

    const value = coerce(fn, argValue, specs);
    const before = status.find((dp) => dp.code === argCode)?.value;
    console.log(
      `\nComando: ${argCode} = ${pretty(argCode, value, specs)}` +
        (before !== undefined ? ` (antes: ${pretty(argCode, before, specs)})` : "")
    );

    let res;
    try {
      res = await api("POST", `/v1.0/iot-03/devices/${dev.id}/commands`, {
        body: { commands: [{ code: argCode, value }] },
      });
    } catch (e) {
      if (e.path?.includes("iot-03")) {
        console.log(`  (iot-03 falhou: ${e.message} — tentando endpoint v1.0)`);
        res = await api("POST", `/v1.0/devices/${dev.id}/commands`, {
          body: { commands: [{ code: argCode, value }] },
        });
      } else {
        throw e;
      }
    }
    console.log(`Resposta: ${JSON.stringify(res)}`);

    console.log("\nAguardando o status refletir na nuvem (até 10 s)…");
    const deadline = Date.now() + 10000;
    let now = before;
    while (Date.now() < deadline && JSON.stringify(now) === JSON.stringify(before)) {
      await sleep(1500);
      const st = await getStatus(dev.id);
      now = st.find((dp) => dp.code === argCode)?.value;
    }
    const ok = JSON.stringify(now) !== JSON.stringify(before);
    console.log(
      ok
        ? `Confirmado: ${argCode} = ${pretty(argCode, now, specs)}`
        : `Ainda sem mudança visível na nuvem (${argCode} = ${pretty(argCode, now, specs)}) — confira o aparelho.`
    );
  }
} catch (e) {
  console.error(`\nFalhou: ${e.message}`);
  if (e.path) console.error(`Endpoint: ${e.path}`);
  printHints(e);
  process.exitCode = 1;
}
