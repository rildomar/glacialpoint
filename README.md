# GlacialPoint

Seu clima, no ponto. Aplicativo desktop independente para controle de ar-condicionado, com interface de vidro inspirada no macOS Tahoe. Windows primeiro; macOS será validado em hardware real depois.

O GlacialPoint conversa direto com as nuvens oficiais de duas linhas de ar-condicionado — **LG ThinQ** (token pessoal, região Brasil) e **Elgin Smart** (plataforma Tuya, via projeto de nuvem próprio). Não há servidor intermediário: leitura e comandos saem deste computador. Stack: Electron + React + TypeScript + Vite + Tailwind, com o processo desktop separado da interface por um preload de API limitada.

## Estado atual

- **LG ThinQ** — conexão validada com a conta real do usuário (2026-10-17, rota do QR para contas Google); o painel lê o estado ao vivo e envia os controles anunciados pelo modelo. Guia completo em [`docs/LG.md`](docs/LG.md).
- **Elgin Smart (Tuya)** — plataforma confirmada na prática (2026-10-17); adaptador de núcleo, push em tempo real, estimativa de consumo e interface (conexão, controle e tutorial) implementados e testados. Falta validar um comando pelo aplicativo com o aparelho real e confirmar a faixa prática de temperatura. Investigação completa em [`docs/ELGIN.md`](docs/ELGIN.md).
- **Energia** — histórico LG validado ao vivo (30 dias e seis meses); estimativa do Elgin implementada (o aparelho não mede energia).
- **macOS** — próximo marco: compilar e validar em hardware real (bandeja/menu bar, foco, posicionamento e Keychain).
- **Distribuição Windows** — `npm run package:win` gera a pasta executável; instalador assinado é marco futuro.

## O que o aplicativo faz

- **Controle real, por integração**: LG ThinQ e Elgin Smart, com abas LG/Elgin quando as duas contas estão conectadas e seletor de aparelho quando há mais de um (a escolha fica lembrada).
- **Só o que o aparelho anuncia**: cada controle aparece conforme as capacidades lidas do modelo; dado ausente é "não informado" — nunca zero presumido.
- **Comandos disciplinados**: um por vez, sem alteração otimista e sem repetir POST ambíguo; depois do envio, uma leitura confirma o novo estado.
- **Tempo real**: o Elgin recebe atualizações empurradas pela nuvem (~1 s, inclusive mudanças feitas por fora, no celular ou no controle físico); o LG consulta por polling — 20 s com o painel visível, 5 min oculto ou após erro, com pausa na suspensão.
- **Consumo e custo**: tela de energia por integração (histórico ThinQ no LG; estimativa por tempo ligado no Elgin), tarifa em R$/kWh e custo mensal estimado.
- **Tutoriais dentro do aplicativo**: "Como conectar" para as duas integrações, com passo a passo ilustrado e botões que abrem os portais oficiais.
- **Painel de bandeja (Windows)**: abre junto à bandeja, oculta ao perder foco, ao pressionar Escape ou ao fechar; arraste pelo cabeçalho e a posição fica guardada entre aberturas.
- **Conforto**: temas claro/escuro, respeito a "Reduzir movimento" do sistema e ajuste para telas pequenas.
- **Sugestão de integração**: registra um rascunho local; o canal de envio será definido antes de habilitar pedidos.

## Conectar as contas

Os passos completos estão no próprio aplicativo — botão **"Como conectar"** nos painéis de boas-vindas, ou **Configurações → integração → Passo a passo de conexão**. Resumo:

**LG ThinQ** — cadastre o ar no aplicativo LG ThinQ (mesma conta que vai gerar o token); gere um token pessoal em <https://connect-pat.lgthinq.com/> (contas via Google entram pela rota do QR com a câmera do celular); cole em **Configurações → LG ThinQ**. Detalhes, renovação e problemas comuns em [`docs/LG.md`](docs/LG.md).

**Elgin Smart** — o vínculo funciona com o app **Smart Life** (repareie o Wi-Fi se necessário: tecla IONAIR 8×); crie um projeto **Cloud** gratuito na plataforma Tuya IoT (datacenter da conta — no Brasil, Western America), ative os serviços Smart Home Basic Service e Device Status Notification e vincule a conta em Devices → Link App Account; cole Access ID e Secret em **Configurações → Elgin Smart**. Investigação e detalhes em [`docs/ELGIN.md`](docs/ELGIN.md).

## Segurança das credenciais

- O token LG e o Access ID/Secret do Elgin nunca ficam na interface: são digitados em campos protegidos, entregues por IPC ao processo principal e guardados criptografados pelo sistema (Electron safeStorage/DPAPI) em `lg-credential.bin` e `elgin-credential.bin`, na pasta de dados do aplicativo. Sem fallback em texto puro.
- Nada de segredo em código, logs, testes, screenshots ou no repositório; fixtures de teste são anonimizadas e respostas reais nunca entram no repositório.
- Desconectar apaga a cópia local; para revogar na origem, apague o token no portal da LG ou gere credenciais novas no projeto Tuya.
- O cofre do sistema não protege contra outros programas rodando sob a mesma conta do Windows.

## Rodar o projeto

Requisitos: Node.js + npm (Windows para o aplicativo desktop; os testes de interface usam o Microsoft Edge instalado). Esta versão não usa Rust nem módulos nativos próprios; o Electron traz o Chromium, sem depender do WebView2 do sistema.

```sh
npm ci          # instalar
npm run dev     # prévia no navegador — http://127.0.0.1:1420
npm run build   # typecheck (src + electron) + build da interface + bundle do desktop
```

A prévia é uma demonstração sem credenciais: aparelho LG simulado, explicitamente identificado, e preferências de demonstração em memória; o seletor mostra só o demonstrativo e o Elgin aparece nas configurações. A caixa de sugestões salva um rascunho no armazenamento local e não envia pedidos.

```sh
npm run desktop:dev     # Electron em desenvolvimento (Vite na 1421)
npm run desktop:start   # build + Electron com a interface compilada
npm run package:win     # pasta executável em release/win-unpacked (manter a pasta completa)
npm run dist:win        # instalador NSIS de desenvolvimento (sem assinatura)
```

Mudanças no processo Electron/preload exigem reiniciar o `desktop:dev`. O aplicativo permite uma instância por perfil. Inicie por um terminal comum do Windows: apps empacotados (MSIX) virtualizam o `%APPDATA%` e as credenciais salvas não aparecem em execuções normais.

## Testes

| Comando | O que cobre |
|---|---|
| `npm run test:e2e` | Interface no navegador (Playwright + Edge): **17 casos** — prévia, formulários de conexão, controles por capacidade, energia, alternância de integrações e tutoriais |
| `npm run test:lg` | Núcleo LG (node): **11 casos** — token, descoberta, perfil/estado, comandos, energia e tarifa |
| `npm run test:elgin` | Núcleo Elgin (node): **31 casos** — fixtures, comandos estritos, assinatura, paginação, sessão, push em tempo real e estimativa de consumo |
| `npm run test:desktop` | Electron compilado: bridge, IPC, isolamento da interface, bloqueio de novas janelas, fechamento para a bandeja, área de arrasto e memória de posição |

O teste desktop usa um perfil temporário separado. `npm run build` limpo é esperado antes de qualquer commit.

## Energia e tarifa

A tela de consumo (ícone de gráfico) segue a integração e o aparelho dos controles — e permite trocar a seleção no topo quando há mais de uma opção.

- **LG — histórico real**: perfil de energia e histórico ThinQ de 30 dias completos mais seis meses (incluindo o atual), no calendário de America/Sao_Paulo. Valores em Wh são convertidos para kWh; ausências ficam como sem leitura (zero real continua zero) e o mês atual é parcial.
- **Elgin — estimativa**: o aparelho não reporta consumo, então o aplicativo estima por tempo ligado (logs do canal `switch`, janela de 7 dias) vezes um consumo médio configurável (padrão 0,7 kWh/h), com acumulado diário que sobrevive a dias sem abrir a tela. O painel marca **ESTIMATIVA** e explica o cálculo.
- **Tarifa**: Configurações → Energia (ou atalho no resumo de consumo) salva a tarifa em R$/kWh no `energy-settings.json`. O custo estimado usa a tarifa atual vezes o consumo do mês; campo vazio remove a estimativa; sem cobranças fixas nem histórico de tarifas. A tarifa não é enviada a nenhuma nuvem.
- Resultados ficam em cache por até cinco minutos e são descartados ao trocar sessão/aparelho.
- Validação: consultas reais de 30 dias e seis meses responderam com leituras para o LG conectado; nenhum comando de controle foi enviado nessa verificação.

## Arquitetura

- `src/` — interface React (painéis LG/Elgin, energia, configurações, tutoriais) e dados simulados da prévia, sempre identificados como tais.
- `electron/` — processo desktop: `main.ts` (janela, bandeja, IPC, posição da janela), `preload.ts` (API mínima) e stores (credenciais, tarifa, estimativa de consumo, posição da janela).
- `electron/core/` — integrações e regras independentes da interface: cliente/sessão LG, cliente/sessão/push/energia Elgin e validação de comandos.
- `shared/` — contratos TypeScript compartilhados entre interface e processo principal; mudança aqui atualiza os dois lados juntos.
- `tests/` — Playwright (prévia) e testes de núcleo (node), com fixtures anonimizadas.
- `scripts/` — build do desktop, testes de núcleo/desktop e sondas da API Tuya (`tuya-probe`, `tuya-control`, `tuya-pulsar`, `tuya-energy`).
- `docs/` — [`LG.md`](docs/LG.md), [`ELGIN.md`](docs/ELGIN.md) e [`ROADMAP.md`](docs/ROADMAP.md).
- A interface só fala com o processo principal pelo preload; credenciais nunca cruzam essa ponte. Os efeitos de vidro são CSS sobre uma paisagem gerada em CSS — não é uma implementação nativa de Liquid Glass; materiais nativos do macOS ficam para o marco E.

## Origem e licenças

O Celsius de Gabriel Villarinho é a referência da integração LG portada para TypeScript. Base examinada: `1bb0c66d137a13defbb3f6b41d82cfd4a02b23cb`, também presente no fork [rildomar/celsius](https://github.com/rildomar/celsius). Cliente, modelos e payloads foram adaptados; fixtures de perfil e estado foram reaproveitadas com atribuição. Consulte [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) e `licenses/Celsius-MIT.txt`. O projeto é licenciado sob MIT (`LICENSE`).
