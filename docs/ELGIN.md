# Integração Elgin Smart (Tuya Cloud) — conexão, investigação e operação

Marco F do ROADMAP. Estado: **caminho B concluído — leitura e controle via OpenAPI validados ao vivo (2026-10-17); adaptador de núcleo, push em tempo real, estimativa de consumo e interface (conexão, controle e tutoriais) implementados e testados**. Falta a validação de um comando pelo aplicativo com o aparelho real e a confirmação da faixa prática de temperatura. O aparelho fica no escritório do usuário, então o requisito é **controle remoto via nuvem** (protocolo local de LAN não atende; pode virar melhoria futura para controle rápido no local).

O que o aplicativo faz hoje com o Elgin:

- Controla liga/desliga, modo, temperatura, swing horizontal, eco, sono, luz e trava — apenas o que o aparelho anuncia (capacidades lidas do projeto Tuya).
- Recebe mudanças **em tempo real** (~1 s), inclusive as feitas por fora (Smart Life ou controle físico), com o polling como rede de segurança — e abrir o painel consulta na hora quando a última leitura tem mais de 10 s.
- **Estima o consumo** por tempo ligado (o aparelho não mede energia), com consumo médio configurável.
- Traz o passo a passo de conexão dentro do próprio aplicativo, e o Elgin participa das abas e da tela de consumo junto do LG.

## Aparelho do usuário

- Linha: Split High Wall **Eco Inverter III WiFi** (família HJ; "Eco 3").
- Unidade do usuário (etiqueta da unidade interna): **HJFI12C2WG** — "INT HW ECO INV III 12 FR 220V1F R32" (12.000 BTU/h, 220 V, 1 fase, gás R32).
- App de controle atual: **Elgin Smart** (`com.elgin.smart`).
- Módulo Wi-Fi da linha III: **TYAUX-J2** (conforme manual oficial da linha).

## Como conectar (do zero)

Os mesmos passos estão ilustrados no aplicativo ("Como conectar" no painel de boas-vindas, ou Configurações → Elgin Smart → Passo a passo de conexão); esta é a versão escrita.

1. **Tenha o ar no aplicativo Smart Life.** O vínculo funciona com contas do Smart Life. Se o ar estiver no app Elgin Smart, repareie o Wi-Fi — com o ar ligado, tecla IONAIR 8× até bipar — e cadastre o aparelho no Smart Life. O controle móvel passa a ser por lá (um aparelho pertence a uma conta por vez).
2. **Crie um projeto na plataforma Tuya IoT** (<https://iot.tuya.com> — o botão "Abrir Tuya IoT" do tutorial vai direto, IPC `elgin:console-page`): conta de desenvolvedor gratuita e um projeto do tipo **Cloud**, no datacenter da sua conta — no Brasil, **Western America**.
3. **Ative os serviços do projeto** em Cloud → My Services: **Smart Home Basic Service** (ler e controlar aparelhos) e **Device Status Notification** (atualizações em tempo real no painel).
4. **Vincule a conta Smart Life** em Devices → Link App Account: adicione a conta e escaneie o QR com o aplicativo Smart Life. O ar deve aparecer na lista do projeto.
5. **Copie as credenciais** na visão geral do projeto: **Access ID** e **Access Secret**.
6. **Preencha no GlacialPoint**, em Configurações → Elgin Smart: Access ID, Secret e região (Western America). Tudo fica criptografado neste computador (safeStorage / `elgin-credential.bin`).

Se algo der errado:

- O fluxo de vínculo pelo aplicativo Elgin Smart **não completa** — use o Smart Life.
- Região errada devolve erro de datacenter (`28841107 — the data center is suspended`): projeto e conta precisam estar no mesmo datacenter.
- Leitura que para com o tempo: confira cotas e serviços autorizados em Cloud → My Services (o trial tem validade).

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

- Sem DP de **velocidade do ventilador** e sem swing vertical na OpenAPI; o adaptador expõe apenas as capacidades acima (liga/desliga, modos, temperatura, swing horizontal, eco, sono, luz e trava).
- `temp_set`: faixa do schema é 16–90 ℃ (160–900, escala 1); testada na prática em 23–24 ℃ — os extremos do split (limite real, provavelmente 16–30 ℃) ainda não foram testados.

## Consumo de energia (sondagem 2026-10-17)

- O modelo de dados do produto declara o DP `power_consumption` (id 28, leitura): contador com **0,03125 kWh por unidade** (texto do modelo: "单位：0.03125KWH，上报的数值*0.03125"), máximo 255 (≈ 8 kWh) e "tudo zero = 0 kWh".
- Na prática **o aparelho não reporta esse DP**: o status mostra sempre `0` e a API de logs não tem um único reporte nos últimos 7 dias — enquanto `temp_current` reportou 100+ vezes, inclusive com o ar ligado durante os testes. Como o histórico de nuvem só existe desde o repareamento (2026-10-17), não há dado de consumo em parte alguma. Sem medição no firmware.
- APIs de estatística (`/v1.0/devices/{id}/statistics/days|months|total` e `all-statistic-type`) retornam `28841101 — API is not subscribed` (faltaria autorizar "IoT Data Analytics" no projeto); o módulo de energia (`/v1.0/m/energy/...`, indicador `ele_usage`) retorna `1010` (serviço "Energy consumption statistics" também não assinado). Mesmo com os serviços, não haveria dado de energia — nada é reportado.
- A **API de logs de DP funciona** (edição gratuita, últimos 7 dias: `GET /v1.0/devices/{id}/logs?type=7`), útil para reconstruir tempo ligado (`switch`) e temperatura (`temp_current`).
- Sonda reutilizável: `node scripts/tuya-energy.mjs` (modelo · status · estatísticas · módulo de energia · logs; ids mascarados).
- Consequência para o analytics: consumo real do Elgin só com medidor externo (tomada inteligente com leitura de energia); sem ele, apenas estimativa a partir do tempo ligado.

### Estimativa de consumo (item A — 2026-10-17)

- Sem tomada com medição e sem DP de energia reportado, o app estima o consumo **localmente**: tempo ligado × **consumo médio configurável** (padrão **0,7 kWh/h**; o campo aceita 0,05–10 na tela Energia de Configurações).
- Tempo ligado: logs do canal `switch` (`GET /v1.0/devices/{id}/logs?type=7&codes=switch`), paginados por `start_row_key = next_row_key` (teto de 10 páginas). A janela cobre **7 dias completos** no fuso `America/Sao_Paulo` (meia-noite de seis dias atrás até agora); eventos viram intervalos, cortados na meia-noite local.
- Acumulado por dia em `energy-estimate.json` no `userData` (escrita atômica): a janela de logs é **autoritativa** para os dias que cobre e os dias que saem da janela ficam congelados com o último valor — a estimativa não se perde se a tela não for aberta por mais de 7 dias.
- Período aberto (ligou e não desligou) só é fechado em "agora" com o estado atual confirmando que está ligado; senão é descartado (conservador).
- No painel, o relatório chega com `source: 'estimate'`, selo **ESTIMATIVA** e a explicação do cálculo; o custo usa a mesma tarifa. O dia corrente entra no acumulado do mês (parcial); o gráfico diário fecha em ontem, como no LG.
- Resultado em cache por 5 minutos; trocar o consumo médio recalcula sem nova consulta à nuvem.
- Testes: `tests/elgin-energy.test.ts` (9 casos) + caso de UI em `tests/elgin-ui.spec.ts`. Sonda ao vivo: `node scripts/tuya-energy.mjs` (seção final refaz a mesma conta sobre os dados reais).

## Adaptador no núcleo (2026-10-17)

- Contratos: `shared/elgin.ts` (aparelho, capacidades, estado, comandos, snapshot) espelhando `shared/lg.ts`; `DesktopBridge.elgin` expõe snapshot, conectar, desconectar, selecionar, atualizar, comando e assinatura de mudanças.
- Cliente: `electron/core/elgin-client.ts` — assinatura HMAC-SHA256, token renovado uma única vez em `1010`, descoberta paginada filtrando categoria `kt`, perfil a partir de `functions` + `specifications` (escala dos sensores) e estado em °C.
- Sessão: `electron/core/elgin-session.ts` — mesmo ciclo do LG: geração/abort, credencial salva só depois da descoberta, um comando por vez, confirmação por leitura após o envio, sem repetição de POST ambíguo, polling 20 s/5 min e pausa em suspensão.
- Credenciais: Access ID/Secret + região no `safeStorage` (`elgin-credential.bin`), sem fallback em texto puro. Nada de `local_key`/`ip` da resposta crua entra em contratos, fixtures ou logs.
- Testes: `npm run test:elgin` (32 casos: fixtures, comandos estritos, assinatura, paginação, erros, renovação de token, corridas de sessão e desconexão, push em tempo real e estimativa de consumo). Fixtures anonimizadas em `tests/fixtures/elgin-*.json`.
- Validação real (somente leitura): o cliente do app rodou contra a API do projeto do usuário — 1 ar encontrado, capacidades e estado lidos corretamente (24 ℃). O envio de comando foi validado via scripts; a validação pelo aplicativo segue pendente.

## Tempo real (push) — 2026-10-17

- Antes o painel só descobria mudanças pelo polling (20 s). Agora `electron/core/elgin-push.ts` escuta o **Tuya Message Service (Pulsar sobre WebSocket)** — o mesmo canal dos apps oficiais — e a sessão aplica cada relatório como leitura confirmada: mudanças feitas por fora (Smart Life ou controle físico) aparecem em ~1 s. Com o canal comprovado (`pushedAt`), o polling vira rede de segurança (5 min).
- Protocolo replicado dos SDKs oficiais: `wss://…:8285/ws/v2/consumer/persistent/{accessId}/out/event/{accessId}-sub`, headers de autenticação `username`/`password` (senha `md5(accessId + md5(secret))[8:24]`). O conteúdo vem cifrado em AES-GCM (nonce de 12 bytes na frente, etiqueta de 16 no fim) ou AES-ECB no modo legado, com a chave nos 16 caracteres centrais do secret; somente os pares código/valor do aparelho escolhido chegam adiante — nada de credencial ou payload cru em log ou estado.
- Robustez: reconexão com backoff (3 s → 60 s), ping a cada 30 s, descarte de eventos de ciclo de vida e deduplicação das mensagens gêmeas (a nuvem manda o mesmo relatório nos protocolos 4 e 1000). HTTP 401 no handshake significa serviço de mensagens não assinado no projeto: o link para em `unauthorized` em vez de insistir. O projeto precisou dos serviços **Smart Home Basic Service** e **Device Status Notification** (Cloud → My Services).
- Testes: `tests/elgin-push.test.ts` (socket dublê: senha, handshake, decifragem, dedupe, reconexão e 401). Sonda ao vivo: `node scripts/tuya-pulsar.mjs` (escuta e imprime os relatórios, ids mascarados).

## Interface no painel (2026-10-17)

- `src/ElginConnection.tsx`: conexão em Configurações por Access ID, Access Secret (campo protegido) e região. O formulário limpa o segredo no envio e não grava credenciais em `localStorage`; a sessão continua no `safeStorage` do núcleo.
- `src/LiveElginPanel.tsx`: seleção de aparelho, energia, modos, temperatura, swing horizontal, eco, sono, luz e trava — cada controle só aparece quando a capacidade correspondente é anunciada pelo aparelho. Mesmo ciclo do LG: um comando por vez, overlay de confirmação e nenhuma atualização otimista.
- Com as duas integrações conectadas, abas **LG ThinQ** / **Elgin Smart** alternam os painéis; a escolha é lembrada em `localStorage` (apenas o identificador da integração, sem credenciais).
- Temperatura: o DP anuncia 16–90 ℃ porque a mesma faixa atende ao modo Fahrenheit; para o split em Celsius a interface limita o ajuste a **16–30 ℃** até a validação dos extremos no aparelho. O protocolo continua aceitando a faixa anunciada.
- Passo a passo de conexão dentro do app: 6 passos cobrindo conta, projeto, serviços e vínculo (tela "Como conectar", acessível pelo painel de boas-vindas e por Configurações → Elgin Smart), com mocks animados e botão que abre o console Tuya (`iot.tuya.com`) pelo próprio app.
- Testes: `tests/elgin-ui.spec.ts` (7 casos) cobre limpeza das credenciais, controles condicionados às capacidades, overlay, alternância LG/Elgin, persistência da escolha, a conexão com o LG já ativo, o consumo estimado (selo ESTIMATIVA e explicação), o seletor de aparelhos, a troca de integração na tela de análise e o tutorial de conexão. Suíte Playwright completa: 17/17.

## Limitações esperadas (a confirmar na prática)

- Projeto Tuya com serviço de nuvem (trial — verificar expiração e cotas em Cloud → My Services).
- Região/datacenter do projeto precisa corresponder à do app/da conta; com o serviço habilitado apenas no DC do projeto, chamadas de outros DCs retornam `28841107 — data center is suspended` mesmo com token válido.
- Comportamentos de sessão única entre app móvel e integração.
- Um aparelho pertence a uma conta por vez — o caminho B move o controle móvel para o Smart Life.

## Próximos passos

1. ✅ **Repareamento no Smart Life** (2026-10-17): aparelho removido do Elgin Smart e cadastrado no Smart Life (reset do Wi-Fi via IONAIR 8× conforme o manual).
2. ✅ **Vínculo da conta ao projeto Tuya IoT** (Western America) e **sonda de leitura** validada: status, funções e especificação lidos com sucesso.
3. ✅ **Teste de controle ao vivo** (2026-10-17): ligar/desligar, modo, temperatura e luz via `POST /v1.0/iot-03/devices/{id}/commands` — efeito confirmado na API **e** no aparelho.
4. ✅ **Adaptador de núcleo** (2026-10-17): `shared/elgin.ts`, `elgin-client.ts`/`elgin-session.ts`, credencial no `safeStorage` e testes (`npm run test:elgin`) — leitura validada contra a API real.
5. ✅ **Fixtures anonimizadas** (`tests/fixtures/elgin-*.json`).
6. ✅ **Interface** (2026-10-17): conexão por Access ID/Secret + região, seleção de aparelho, controles conforme capacidades, abas LG/Elgin, seletor de integração no consumo e tutoriais; testes de UI.
7. ✅ **Tempo real e estimativa de consumo** (2026-10-17): push Pulsar integrado à sessão e estimativa por tempo ligado com consumo médio configurável.
8. **Validação pelo aplicativo** com o aparelho real: conectar pela tela de Configurações e enviar um comando (ex.: luz ou liga/desliga), confirmando o efeito físico e a leitura de volta.
9. Confirmar a faixa prática de temperatura (16–30 ℃ na interface) e a semântica de `heat`/`health`/`gear_horizontal` (não expostos).

## Referências

- Manual Wi-Fi Eco Inverter III (módulo TYAUX-J2): `leverosintegra.com.br/download/manuais/Elgin/manual-instrucoes-wifi-elgin-eco-inverter-iii-wifi-12k.pdf`
- Ficha de produto com fabricante "Hangzhou Tuya": `efacil.com.br` (HJFC12C2WGCG)
- Reddit r/ArCondicionado — thread do Eco III ("Tuya / Smartlife")
- Fórum Home Assistant Brasil — repareamento via Smart Life
- Integração comunitária da linha II (AUX Cloud): `github.com/asnunes/ha-elgin-air-hjfc` (fork de `maeek/ha-aux-cloud`)
- Tuya — mapeamento de contas de apps OEM para datacenters: `developer.tuya.com/en/docs/iot/oem-app-data-center-distributed`
- Tuya — fluxo de vinculação por conta de app ("Link devices by app account"): `developer.tuya.com/en/docs/iot/link-devices`
- Fórum Home Assistant — casos de apps OEM com o mesmo erro de datacenter/QR expirado: `community.home-assistant.io/t/tuya-integration-ha-2024-02-qr-code/686633`
