#!/usr/bin/env node
/**
 * Escuta em tempo real — Tuya Message Service (Pulsar sobre WebSocket)
 *
 * GlacialPoint · marco F · push em nuvem
 *
 * Abre uma conexão de saída com o serviço de mensagens da Tuya (o mesmo tipo
 * de canal que faz o app oficial refletir mudanças na hora) e imprime, em
 * tempo real, cada atualização de estado que a nuvem empurra. Protocolo
 * idêntico ao dos SDKs oficiais (Python/.NET/Go):
 *   URL  wss://mqe.tuyaus.com:8285/ws/v2/consumer/persistent/<accessId>/out/<tópico>/<accessId>-sub
 *   auth headers username/password (md5 no formato do SDK)
 *   mensagem: envelope JSON com `payload` base64; dentro, `data` cifrado com
 *   AES-GCM (12 bytes de nonce + conteúdo + 16 de tag) ou AES-ECB legado;
 *   chave = 16 caracteres do meio do Access Secret.
 *
 * Uso:
 *   node scripts/tuya-pulsar.mjs                 # canal de produção
 *   node scripts/tuya-pulsar.mjs --test          # canal de teste (event-test)
 *   node scripts/tuya-pulsar.mjs --segundos 30   # encerra sozinho
 *   node scripts/tuya-pulsar.mjs --once          # encerra na 1ª mensagem
 *
 * Credenciais: as mesmas da sonda (~/.config/glacialpoint/tuya.json, 600).
 * Variáveis: TUYA_CONFIG (caminho das credenciais) · TUYA_DEVICE=<id> filtra
 * um aparelho · TUYA_PROBE_FULL=1 mostra ids completos.
 *
 * Segurança: nunca imprime Access ID/Secret; ids mascarados por padrão.
 */

import { createDecipheriv, createHash } from "node:crypto";
import { loadConfig, mask } from "./tuya-lib.mjs";
import WebSocket from "ws";

// Espelho dos endpoints do SDK oficial (region da sonda → host do serviço).
const PULSAR_WSS = {
  us: "wss://mqe.tuyaus.com:8285/", // Western America
  ue: "wss://mqe.tuyaus.com:8285/", // Eastern America
  eu: "wss://mqe.tuyaeu.com:8285/", // Central Europe
  we: "wss://mqe.tuyaeu.com:8285/", // Western Europe
  cn: "wss://mqe.tuyacn.com:8285/",
  in: "wss://mqe.tuyain.com:8285/",
};

const TOPICS = { prod: "event", test: "event-test" };
const RECONNECT_MS = [3000, 10000, 30000, 60000];
const PING_MS = 30000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const testChannel = flag("--test");
const firstOnly = flag("--once");
const seconds = Number(opt("--segundos", "0")) || 0;

const { cfg } = loadConfig();
const wss = PULSAR_WSS[cfg.region ?? "us"];
if (!wss) {
  console.error(`region desconhecida: ${cfg.region} (opções: ${Object.keys(PULSAR_WSS).join(", ")})`);
  process.exit(1);
}

const md5hex = (s) => createHash("md5").update(s, "utf8").digest("hex");

/** Senha do WebSocket na derivação do SDK oficial: md5(accessId + md5(secret))[8:24]. */
const wsPassword = () => md5hex(cfg.accessId + md5hex(cfg.accessSecret)).slice(8, 24);

/** Decifra o bloco `data` (base64): AES-GCM (novo, `em: "aes_gcm"`) ou AES-ECB legado. */
function decryptPayload(dataB64, model) {
  const key = Buffer.from(cfg.accessSecret.slice(8, 24), "utf8");
  const buf = Buffer.from(dataB64, "base64");
  if (model === "aes_gcm") {
    if (buf.length < 12 + 16) throw new Error("bloco GCM curto demais");
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const body = buf.subarray(12, buf.length - 16);
    const d = createDecipheriv("aes-128-gcm", key, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  }
  const d = createDecipheriv("aes-128-ecb", key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(buf), d.final()])
    .toString("utf8")
    .replace(/[\u0000-\u001f]+$/g, "");
}

function show(doc, meta) {
  const t = new Date().toLocaleTimeString("pt-BR");
  const proto = meta.protocol !== undefined ? `protocolo ${meta.protocol}` : "sem protocolo";
  // Formato IoT Core (protocolo 1000): { bizCode: "devicePropertyMessage", bizData }
  if (doc?.bizCode === "devicePropertyMessage" && doc.bizData) {
    const { devId, properties = [] } = doc.bizData;
    console.log(`\n[${t}] ${proto} · propriedades · aparelho ${mask(devId)}`);
    for (const p of properties) console.log(`  ${p.code} = ${JSON.stringify(p.value)}`);
    return;
  }
  // Formato legado (protocolo 4): { devId, status: [{ code, value }] }
  if (doc?.devId || doc?.deviceId) {
    const devId = doc.devId ?? doc.deviceId;
    if (Array.isArray(doc.status) && doc.status.length) {
      console.log(`\n[${t}] ${proto} · status · aparelho ${mask(devId)}`);
      for (const s of doc.status) console.log(`  ${s.code} = ${JSON.stringify(s.value)}`);
      return;
    }
    console.log(`\n[${t}] evento: ${doc.bizCode ?? "?"} · aparelho ${mask(devId)}`);
    return;
  }
  console.log(`\n[${t}] mensagem (formato não reconhecido):`, JSON.stringify(doc).slice(0, 300));
}

const wantDevice = process.env.TUYA_DEVICE;
let attempt = 0;
let stopping = false;

function connect() {
  const topic = testChannel ? TOPICS.test : TOPICS.prod;
  const url =
    `${wss}ws/v2/consumer/persistent/${encodeURIComponent(cfg.accessId)}/out/${topic}/` +
    `${encodeURIComponent(cfg.accessId)}-sub?ackTimeoutMillis=3000&subscriptionType=Failover`;

  console.log(
    `Conectando ao serviço de mensagens (canal ${testChannel ? "de teste" : "de produção"}, ${new URL(wss).host})…`
  );
  const ws = new WebSocket(url, {
    headers: { username: cfg.accessId, password: wsPassword() },
  });

  ws.on("open", () => {
    attempt = 0;
    console.log("Conectado. Aguardando mensagens… (Ctrl+C encerra)\n");
  });

  ws.on("message", (raw) => {
    let env;
    try {
      env = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Confirma (ack) antes de processar — mensagem sem ack é reentregue.
    if (env?.messageId) {
      try {
        ws.send(JSON.stringify({ messageId: env.messageId }));
      } catch {
        // ack falhou; a nuvem reentrega depois
      }
    }
    if (!env?.payload) return;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8"));
    } catch {
      return;
    }
    let doc;
    try {
      doc = JSON.parse(decryptPayload(payload.data, env.properties?.em));
    } catch (e) {
      console.error("Uma mensagem não pôde ser decifrada:", e.message);
      return;
    }
    const devId = doc?.devId ?? doc?.deviceId ?? doc?.bizData?.devId;
    if (wantDevice && devId && devId !== wantDevice) return;
    show(doc, payload);
    if (firstOnly) {
      stopping = true;
      console.log("\nPrimeira mensagem recebida — encerrando (modo --once).");
      setTimeout(() => process.exit(0), 100);
    }
  });

  ws.on("unexpected-response", (_req, res) => {
    const code = res.statusCode;
    console.error(`Handshake recusado: HTTP ${code}.`);
    if (code === 401) {
      console.error(
        "Dica: 401 = serviço de mensagens não habilitado (ou habilitado no data center errado)\n" +
          "      no projeto Tuya, ou credenciais divergentes. Confira Cloud → projeto → Message Service."
      );
      stopping = true;
      process.exitCode = 1;
      ws.terminate();
    }
  });

  ws.on("error", (e) => {
    if (!stopping) console.error(`Erro na conexão: ${e.message}`);
  });

  const ping = setInterval(() => {
    try {
      ws.ping();
    } catch {
      // o close/reconnect cuida
    }
  }, PING_MS);

  ws.on("close", () => {
    clearInterval(ping);
    if (stopping) {
      console.log("Encerrado.");
      return;
    }
    const wait = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
    attempt += 1;
    console.log(`Conexão fechada — reconectando em ${Math.round(wait / 1000)} s…`);
    setTimeout(connect, wait);
  });
}

process.on("SIGINT", () => {
  stopping = true;
  console.log("\nEncerrando…");
  process.exit(0);
});

if (seconds > 0) {
  setTimeout(() => {
    stopping = true;
    console.log("\nTempo esgotado — encerrando.");
    process.exit(0);
  }, seconds * 1000);
}

connect();
