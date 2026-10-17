/**
 * Núcleo compartilhado das sondas Tuya Cloud (GlacialPoint · marco F · caminho B)
 *
 * Autenticação e assinatura HMAC-SHA256 conforme
 * developer.tuya.com/en/docs/iot/singnature — usado por tuya-probe.mjs
 * (leitura) e tuya-control.mjs (comandos).
 *
 * Credenciais (fora do repositório, nunca commitar):
 *   ~/.config/glacialpoint/tuya.json   (permissão 600)
 *   { "accessId": "...", "accessSecret": "...", "region": "us" }
 *
 * Segurança: nada aqui imprime Access ID/Secret; ids de aparelho/usuário são
 * mascarados por padrão (TUYA_PROBE_FULL=1 mostra os valores completos).
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOSTS = {
  us: "openapi.tuyaus.com", // Western America
  ue: "openapi-ueaz.tuyaus.com", // Eastern America
  eu: "openapi.tuyaeu.com", // Central Europe
  we: "openapi-weaz.tuyaeu.com", // Western Europe
  cn: "openapi.tuyacn.com",
  in: "openapi.tuyain.com",
  sg: "openapi-sg.iotbing.com",
};

export function loadConfig() {
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

  return { cfg, host, configPath };
}

export const mask = (v) =>
  process.env.TUYA_PROBE_FULL === "1" || typeof v !== "string" || v.length < 14
    ? v
    : `${v.slice(0, 6)}…${v.slice(-4)}`;

/**
 * Cliente da OpenAPI: assina cada requisição e busca o token sozinho na
 * primeira chamada autenticada (ou via refresh() explícito, que devolve o
 * resultado do token — útil para imprimir o tempo de validade).
 */
export function createClient({ accessId, accessSecret }, host) {
  const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const hmac = (s) => createHmac("sha256", accessSecret).update(s, "utf8").digest("hex").toUpperCase();

  let token = "";

  async function raw(method, path, { query = null, body = null, auth = true } = {}) {
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
      client_id: accessId,
      sign_method: "HMAC-SHA256",
      t,
      sign: hmac(accessId + (auth ? token : "") + t + stringToSign),
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

  async function request(method, path, opts = {}) {
    if (opts.auth !== false && !token) await refresh();
    return raw(method, path, opts);
  }

  async function refresh() {
    const r = await raw("GET", "/v1.0/token", { query: { grant_type: 1 }, auth: false });
    token = r.access_token;
    return r;
  }

  return { request, refresh };
}

export function printHints(e) {
  const codigo = String(e.message).split(":")[0].trim();
  const dicas = {
    1004: "Access ID/Secret incorretos — confira Overview → Authorization Key.",
    1106: "A conta do app ainda não está vinculada a este projeto.",
    2009: "Credenciais ausentes ou inválidas (clientId) — confira o arquivo de configuração.",
    2406: "Datacenter não bate com o vínculo — se vinculou em Eastern America, use region \"ue\".",
    28841105: "Faltam serviços de API autorizados no projeto (Authorize API Services).",
    28841107: "Datacenter suspenso para as APIs de aparelho — use a região do vínculo (region \"us\" = Western America).",
  };
  if (dicas[codigo]) console.error(`Dica: ${dicas[codigo]}`);
}
