# Integração Elgin — investigação e plano

Marco F do ROADMAP. Estado: **caminho B concluído — leitura e controle via OpenAPI validados ao vivo (2026-10-17)**; próximo passo é o adaptador em `electron/core/`. O aparelho fica no escritório do usuário, então o requisito é **controle remoto via nuvem** (protocolo local de LAN não atende; pode virar melhoria futura para controle rápido no local).

## Aparelho do usuário

- Linha: Split High Wall **Eco Inverter III WiFi** (família HJ; "Eco 3").
- Unidade do usuário (etiqueta da unidade interna): **HJFI12C2WG** — "INT HW ECO INV III 12 FR 220V1F R32" (12.000 BTU/h, 220 V, 1 fase, gás R32).
- App de controle atual: **Elgin Smart** (`com.elgin.smart`).
- Módulo Wi-Fi da linha III: **TYAUX-J2** (conforme manual oficial da linha).

## Evidências sobre o backend

- O módulo TYAUX-J2 tem "Tuya" no nome; ficha de produto de varejo da linha (HJFC12C2WGCG) lista fabricante **"Hangzhou Tuya"**, modelo "TYAUX_J".
- Relato no Reddit (r/ArCondicionado): dono de Eco III pergunta por app alternativo; resposta da comunidade: **"Tuya / Smartlife"**.
- Relato no Fórum Home Assistant Brasil: ar-condicionado Elgin integrado pareando o aparelho no app **Smart Life** (mesma plataforma Tuya) e usando Tuya Local/Tuya oficial.
- Contraste importante: a linha anterior (Eco Inverter II, app **Elgin Air** — pacote `cn.com.auxgroup...`) tem integração comunitária de Home Assistant apontando backend **AUX Cloud/Broadlink**. Há sobreposição de relatos sobre módulos TYAUX-J/J2 entre as gerações — mais um motivo para não assumir sem teste.

**Plataforma confirmada na prática (desfecho em 2026-10-17):** a linha roda na **plataforma Tuya** de ponta a ponta. Com o app OEM Elgin Smart, o fluxo "Link Tuya App Account" **não completa** (o app reconhece o QR e confirma, mas a autorização nunca chega ao console; o QR passa a "has expired" com aviso de datacenter) — testado nos projetos Western e Eastern America. O fluxo oficial é documentado para contas dos apps **Tuya Smart / Smart Life**; seguindo o caminho B (reparear no Smart Life), o vínculo completou e a leitura e o controle via API foram validados. Região da conta no app: Eu → Configurações → Conta e Segurança → Região.

## Caminhos avaliados

| Caminho | O que é | Custo/risco |
|---|---|---|
| **A — Vincular conta ao projeto Tuya IoT** | Criar um projeto na plataforma de desenvolvedor Tuya e usar o fluxo "Link App Account" (QR) com o app Elgin Smart. Não invasivo: o aparelho continua no app | **Testado: não completa** — o app OEM reconhece e confirma o QR, mas a autorização não chega ao console (testado em Western e Eastern America). O fluxo "Link Tuya App Account" é documentado para contas Tuya Smart/Smart Life |
| **B — Reparear no app Smart Life** | Resetar o Wi-Fi do aparelho (com o ar ligado, tecla IONAIR 8× no controle → 2 bipes) e cadastrá-lo no Smart Life; depois vincular ao projeto Tuya IoT | Caminho documentado pela comunidade; exige acesso físico e o controle móvel sai do app Elgin Smart (um aparelho vive em uma conta por vez). **Concluído em 2026-10-17: repareamento + vínculo + leitura + controle via API validados (teste ao vivo)** |
| **C — Controle local (tinytuya)** | Falar direto com o módulo na rede local | Descartado por ora: exige estar na rede do escritório e extrair local key; não atende o controle remoto |

## Resultado do caminho B (2026-10-17)

- Conta Smart Life vinculada ao projeto Tuya IoT; a API lista dois aparelhos: **"Ar - escritório"** (categoria `kt`) e **"Fita led bancada"** (fita LED, categoria `dd` — fora do escopo por ora).
- Datacenter: o projeto responde em **Western America** (`region: "us"`). O token autentica em todos os DCs testados (us/ue/eu/we/in), mas a API de dispositivos só funciona no DC do projeto; nos demais retorna `28841107 — the data center is suspended`.
- Scripts (Node, sem dependências): `scripts/tuya-probe.mjs` (leitura de aparelhos, status, funções e especificação), `scripts/tuya-control.mjs` (envio de comando e acompanhamento do status; ex.: `node scripts/tuya-control.mjs set switch false`) e `scripts/tuya-lib.mjs` (autenticação/assinatura compartilhada). Credenciais fora do repositório, em `~/.config/glacialpoint/tuya.json` (permissão 600).
- Endpoints que funcionaram (GET):
  - `/v1.0/token?grant_type=1`
  - `/v1.0/iot-01/associated-users/devices?size=50` (paginado via `has_more`/`last_row_key`)
  - `/v1.0/devices/{id}` e `/v1.0/iot-03/devices/{id}/status`
  - `/v1.0/iot-03/devices/{id}/functions` → `{ category, functions: [...] }`
  - `/v1.1/devices/{id}/specifications` → `functions` com `dp_id`
- Envio de comando (validado ao vivo): `POST /v1.0/iot-03/devices/{id}/commands` com corpo `{"commands":[{"code":"...","value":...}]}` → `result: true`; o status na nuvem reflete em poucos segundos.

## Teste de controle ao vivo (2026-10-17)

Com o usuário no escritório observando o aparelho:

| Comando | Enviado | Resultado |
|---|---|---|
| `light` | `false` → `true` | ✅ aceito; luz do painel apagou e voltou (observado) |
| `mode` | `wind` → `cold` | ✅ aceito; compressor parou e voltou a gelar (observado/audível) |
| `temp_set` | `23` (230) → `24` (240) | ✅ aceito; valor refletiu na nuvem (décimos de ℃, escala 1) |
| `switch` | `false` → `true` | ✅ aceito; o ar desligou e religou (observado) |

- Todos responderam `result: true` e o status na nuvem refletiu a mudança em poucos segundos (poll de 1,5 s).
- Estado final igual ao inicial (ligado · frio · 24 ℃ · luz acesa): nenhum ajuste perdido no ciclo.

## Capacidades do aparelho (lidas via OpenAPI)

Controle:

| DP | código | tipo | domínio |
|---|---|---|---|
| 1 | `switch` | Boolean | liga/desliga |
| 2 | `temp_set` | Integer | 16.0–90.0 ℃, escala 1, passo 1.0 |
| 4 | `mode` | Enum | `cold` · `hot` · `wet` · `wind` · `auto` |
| 8 | `mode_eco` | Boolean | modo eco |
| 12 | `heat` | Boolean | a confirmar |
| 13 | `light` | Boolean | luz do painel |
| 14 | `lock` | Boolean | trava |
| 33 | `switch_horizontal` | Boolean | swing horizontal (liga/desliga) |
| 34 | `gear_horizontal` | Enum | `["off"]` — status atual `right`; a confirmar |
| 102 | `sleep` | Boolean | modo sono |
| 106 | `health` | Boolean | a confirmar |

Leitura (status): `switch`, `temp_set`, `temp_current`, `mode`, `mode_eco`, `heat`, `light`, `lock`, `power_consumption`, `switch_horizontal`, `gear_horizontal`, `sleep`, `health`.

Notas:

- Sem DP de **velocidade do ventilador** e sem swing vertical na OpenAPI; o adaptador exporá apenas as capacidades acima.
- `temp_set`: faixa do schema é 16–90 ℃ (160–900, escala 1); testada na prática em 23–24 ℃ — os extremos do split (limite real, provavelmente 16–30 ℃) ainda não foram testados.

## Limitações esperadas (a confirmar na prática)

- Projeto Tuya com serviço de nuvem (trial — verificar expiração e cotas em Cloud → My Services).
- Região/datacenter do projeto precisa corresponder à do app/da conta; com o serviço habilitado apenas no DC do projeto, chamadas de outros DCs retornam `28841107 — data center is suspended` mesmo com token válido.
- Comportamentos de sessão única entre app móvel e integração.
- Um aparelho pertence a uma conta por vez — o caminho B move o controle móvel para o Smart Life.

## Próximos passos

1. ✅ **Repareamento no Smart Life** (2026-10-17): aparelho removido do Elgin Smart e cadastrado no Smart Life (reset do Wi-Fi via IONAIR 8× conforme o manual).
2. ✅ **Vínculo da conta ao projeto Tuya IoT** (Western America) e **sonda de leitura** validada: status, funções e especificação lidos com sucesso.
3. ✅ **Teste de controle ao vivo** (2026-10-17): ligar/desligar, modo, temperatura e luz via `POST /v1.0/iot-03/devices/{id}/commands` — efeito confirmado na API **e** no aparelho.
4. **Adaptador** em `electron/core/` (cliente Elgin) com os mesmos contratos de `shared/`, credenciais no `safeStorage`, capacidades lidas do perfil do aparelho e fila serial de comandos como no LG.
5. Fixtures anonimizadas para os testes.

## Referências

- Manual Wi-Fi Eco Inverter III (módulo TYAUX-J2): `leverosintegra.com.br/download/manuais/Elgin/manual-instrucoes-wifi-elgin-eco-inverter-iii-wifi-12k.pdf`
- Ficha de produto com fabricante "Hangzhou Tuya": `efacil.com.br` (HJFC12C2WGCG)
- Reddit r/ArCondicionado — thread do Eco III ("Tuya / Smartlife")
- Fórum Home Assistant Brasil — repareamento via Smart Life
- Integração comunitária da linha II (AUX Cloud): `github.com/asnunes/ha-elgin-air-hjfc` (fork de `maeek/ha-aux-cloud`)
- Tuya — mapeamento de contas de apps OEM para datacenters: `developer.tuya.com/en/docs/iot/oem-app-data-center-distributed`
- Tuya — fluxo de vinculação por conta de app ("Link devices by app account"): `developer.tuya.com/en/docs/iot/link-devices`
- Fórum Home Assistant — casos de apps OEM com o mesmo erro de datacenter/QR expirado: `community.home-assistant.io/t/tuya-integration-ha-2024-02-qr-code/686633`
