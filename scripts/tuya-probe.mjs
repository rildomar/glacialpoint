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
 * O núcleo de assinatura/navegação fica em scripts/tuya-lib.mjs (compartilhado
 * com scripts/tuya-control.mjs). Referências: developer.tuya.com/en/docs/iot/singnature
 * (assinatura) e developer.tuya.com/en/docs/cloud (endpoints v1.0 / iot-03).
 */

import { loadConfig, createClient, mask, printHints } from "./tuya-lib.mjs";

const { cfg, host } = loadConfig();
const client = createClient(cfg, host);
const api = (method, path, opts) => client.request(method, path, opts);

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
  const tk = await client.refresh();
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
  printHints(e);
  process.exitCode = 1;
}
