#!/usr/bin/env node
/**
 * Sonda de leitura — Tuya Cloud (GlacialPoint · marco F · caminho B)
 *
 * O que faz:
 *   1. Autentica na Tuya OpenAPI (Access ID/Secret de um Cloud Project).
 *   2. Lista os aparelhos das contas de app vinculadas ao projeto.
 *   3. Para cada ar-condicionado (categoria "kt"): detalhes, status atual,
 *      funções aceitas e faixas da especificação (modos, temperatura, vento).
 *
 * Uso:
 *   node scripts/tuya-probe.mjs
 *   TUYA_CONFIG=/caminho/para/credenciais.json node scripts/tuya-probe.mjs
 *
 * Credenciais (fora do repositório, nunca commitar):
 *   ~/.config/glacialpoint/tuya.json   (permissão 600)
 *   { "accessId": "...", "accessSecret": "...", "region": "us" }
 *
 * Segurança: este script não imprime Access ID/Secret. IDs de aparelho/usuário
 * aparecem mascarados por padrão; TUYA_PROBE_FULL=1 mostra os valores completos.
 *
 * Referências: developer.tuya.com/en/docs/iot/singnature (assinatura),
 *              developer.tuya.com/en/docs/cloud (endpoints v1.0 / iot-03).
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOSTS = {
  us: "openapi.tuyaus.com", // Western America
  ue: "openapi-ueaz.tuyaus.com", // Eastern America
  eu: "openapi.tuyaeu.com", // Central Europe
  we: "openapi-weaz.tuyaeu.com", // Western Europe
  cn: "openapi.tuyacn.com",
  in: "openapi.tuyain.com",
  sg: "openapi-sg.iotbing.com",
};

const configPath =
  process.env.TUYA_CONFIG ?? join(homedir(), ".config", "glacialpoint", "tuya.json");
const cfg = JSON.parse(readFileSync(configPath, "utf8"));

if (String(cfg.accessId ?? "").includes("PREENCHA") || String(cfg.accessSecret ?? "").includes("PREENCHA")) {
  console.error(`Preencha ${configPath} antes de rodar (Access ID e Access Secret do Cloud Project).`);
  process.exit(1);
}

const host = HOSTS[cfg.region ?? "us"];
if (!host) {
  console.error(`region desconhecida: ${cfg.region} (opções: ${Object.keys(HOSTS).join(", ")})`);
  process.exit(1);
}

const full = process.env.TUYA_PROBE_FULL === "1";
const mask = (v) => (full || typeof v !== "string" || v.length < 14 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (s) => createHmac("sha256", cfg.accessSecret).update(s, "utf8").digest("hex").toUpperCase();

let token = "";

async function api(method, path, { query = null, body = null, auth = true } = {}) {
  const t = String(Date.now());
  const qs = query
    ? Object.keys(query)
        .sort()
        .map((k) => `${k}=${query[k]}`)
        .join("&")
    : "";
  const urlPath = qs ? `${path}?${qs}` : path;
  const bodyStr = body ? JSON.stringify(body) : "";
  const stringToSign = [method, sha256(bodyStr), "", urlPath].join("\n");
  const headers = {
    client_id: cfg.accessId,
    sign_method: "HMAC-SHA256",
    t,
    sign: hmac(cfg.accessId + (auth ? token : "") + t + stringToSign),
  };
  if (auth) headers.access_token = token;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`https://${host}${urlPath}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });
  const json = await res.json().catch(() => null);
  if (!json || json.success !== true) {
    const err = new Error(`${json?.code ?? res.status}: ${json?.msg ?? "resposta não-JSON"}`);
    err.path = urlPath;
    throw err;
  }
  return json.result;
}

async function via(paths) {
  let last;
  for (const path of paths) {
    try {
      return { result: await api("GET", path), path };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

try {
  console.log(`Datacenter: ${cfg.region} → ${host}`);
  const tk = await api("GET", "/v1.0/token", { query: { grant_type: 1 }, auth: false });
  token = tk.access_token;
  console.log(`Autenticação: ok (token válido por ${tk.expire_time}s)`);

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

  if (!listed.length) {
    console.log("\nNenhum aparelho no projeto ainda — faça o vínculo da conta no painel");
    console.log("(Devices → Link Tuya App Account → Add App Account) e rode de novo.");
    process.exit(0);
  }

  const details = [];
  for (const d of listed) {
    details.push(await api("GET", `/v1.0/devices/${d.id}`));
  }
  const acs = details.filter((d) => d.category === "kt");
  const show = acs.length ? acs : details;

  console.log(`\nAparelhos vinculados: ${details.length} (ar-condicionado: ${acs.length})`);
  const others = details.filter((d) => d.category !== "kt");
  if (acs.length && others.length) {
    console.log(`Outros (ignorados): ${others.map((d) => `${d.name} [${d.category}]`).join(", ")}`);
  }

  for (const dev of show) {
    console.log("\n" + "─".repeat(64));
    console.log(`${dev.name} · categoria ${dev.category} · ${dev.online ? "online" : "offline"}`);
    console.log(`Produto: ${dev.product_name} (${dev.product_id})`);
    console.log(`id: ${mask(dev.id)} · uid: ${mask(dev.uid)} · fuso: ${dev.time_zone ?? "?"}`);

    const st = await via([
      `/v1.0/iot-03/devices/${dev.id}/status`,
      `/v1.0/devices/${dev.id}/status`,
    ]);
    console.log(`\nStatus atual (via ${st.path}):`);
    for (const dp of st.result) console.log(`  ${dp.code} = ${JSON.stringify(dp.value)}`);

    const fn = await via([
      `/v1.0/iot-03/devices/${dev.id}/functions`,
      `/v1.0/devices/${dev.id}/functions`,
    ]);
    const fnList = Array.isArray(fn.result) ? fn.result : fn.result?.functions ?? [];
    console.log("\nFunções aceitas (controle):");
    for (const f of fnList) {
      console.log(`  ${f.code} [${f.type}]${f.values && f.values !== "{}" ? ` ${f.values}` : ""}`);
    }

    const sp = await via([
      `/v1.1/devices/${dev.id}/specifications`,
      `/v1.0/iot-03/devices/${dev.id}/specification`,
    ]);
    const spList = Array.isArray(sp.result) ? sp.result : sp.result?.functions ?? [];
    if (spList.length) {
      console.log("\nEspecificação (faixas/unidades):");
      for (const s of spList) {
        console.log(`  ${s.code}${s.dp_id ? ` (dp${s.dp_id})` : ""} [${s.type}] ${s.values ?? ""}`);
      }
    }
  }
} catch (e) {
  console.error(`\nFalhou: ${e.message}`);
  if (e.path) console.error(`Endpoint: ${e.path}`);
  const codigo = String(e.message).split(":")[0].trim();
  const dicas = {
    1004: "Access ID/Secret incorretos — confira Overview → Authorization Key.",
    1106: "A conta do app ainda não está vinculada a este projeto.",
    2406: "Datacenter não bate com o vínculo — se vinculou em Eastern America, use region \"ue\".",
    28841105: "Faltam serviços de API autorizados no projeto (Authorize API Services).",
  };
  if (dicas[codigo]) console.error(`Dica: ${dicas[codigo]}`);
  process.exitCode = 1;
}
