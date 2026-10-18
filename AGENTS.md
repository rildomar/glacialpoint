# AGENTS.md — GlacialPoint

Instruções para agentes de IA que trabalham neste repositório. Leia antes de mexer: `README.md` (estado atual e fluxos do produto) e `docs/ROADMAP.md` (marcos e critérios de aceite). Em conflito, o ROADMAP manda.

## O que é

App desktop independente para controle de ar-condicionado: Electron + React + TypeScript + Vite + Tailwind. Windows primeiro; macOS será validado em hardware real depois. Integração LG ThinQ (Brasil) implementada, com canal de tempo real (push da nuvem via MQTT); Elgin (plataforma Tuya) tem adaptador de núcleo e interface de conexão/controle no painel — falta a validação ao vivo pelo app.

## Mapa do repositório

- `src/` — interface React. Dados simulados sempre identificados como tais.
- `electron/` — processo desktop: main, janela, bandeja e `preload` com API mínima por IPC.
- `electron/core/` — integrações e regras independentes da interface (cliente LG, validação de comandos, ciclo de sessão).
- `shared/` — contratos TypeScript compartilhados; mudança aqui atualiza os dois lados juntos.
- `tests/` — Playwright (prévia), testes de núcleo (node) e fixtures anonimizadas.
- `docs/ROADMAP.md` — escopo e critérios de aceite por marco (A–F).
- `artifacts/`, `dist/`, `dist-electron/`, `release/`, `test-results/` são gerados e ignorados.

## Comandos

```sh
npm ci                  # instalar
npm run dev             # prévia no navegador (127.0.0.1:1420)
npm run build           # typecheck (src + electron) + vite build + scripts
npm run test:e2e        # Playwright (usa Microsoft Edge instalado)
npm run desktop:dev     # Electron em dev (Vite na 1421)
npm run desktop:start   # Electron com build compilado
npm run test:desktop    # smoke do Electron: bridge, IPC, isolamento
npm run test:lg         # núcleo LG (token, descoberta, comandos)
npm run test:elgin      # núcleo Elgin (Tuya: perfil, estado, comandos, sessão)
npm run package:win     # pasta em release/win-unpacked
npm run dist:win        # instaladores NSIS (.exe) e MSI em release/
npm run dist:mac        # dmg no macOS (rodar no Mac ou no workflow de release)
```

Requisito: Node 26+ (veja `.nvmrc`; o CI usa `node-version: 26` no `release.yml`).

Release: tag `v*` igual à versão do `package.json` dispara `.github/workflows/release.yml` — Windows (NSIS `-setup.exe` e MSI) e macOS (dmg `-apple-silicon`/`-intel`) publicados em GitHub Releases. Assinatura de código ainda não existe: os avisos de SmartScreen/Gatekeeper são esperados. Quem publica é o job `release` do workflow (com o `GITHUB_TOKEN` do Actions); os scripts `dist:*` usam `--publish never` para o electron-builder não tentar publicar sozinho.

Nota de build: o Electron 44 não baixa o binário na instalação — o download é preguiçoso, na primeira execução em dev (`npm run desktop:dev`/`desktop:start`). Num clone limpo o `node_modules/electron/dist` não existe; por isso o empacotador não usa `electronDist` e o runtime do Electron vem do cache do próprio electron-builder.

Antes de commitar: `npm run build` limpo, os testes relevantes à mudança — e a validação do usuário testando a mudança no app. Nada de commit antes disso (regra do usuário).

Inicie o app desktop sempre por um terminal comum do Windows. Apps empacotados (MSIX — ex.: Codex, apps da Store) virtualizam `%APPDATA%`: credenciais salvas (`lg-credential.bin`, `elgin-credential.bin`) e a tarifa vão para o contêiner do app hospedeiro e "desaparecem" em execuções normais.

Perfil de dados: em desenvolvimento o app usa a pasta própria `GlacialPoint-Dev`; o app instalado usa `GlacialPoint` — os dois podem rodar ao mesmo tempo (cache e trava de instância única separados). Os testes automatizados apontam o perfil por `GLACIALPOINT_TEST_USER_DATA`.

## Segurança (inegociável)

- Nunca coloque token, credencial ou segredo em chat, código, teste, screenshot, log ou commit.
- O token LG é digitado em campo protegido, entregue por IPC e guardado com Electron `safeStorage` em `lg-credential.bin` (pasta de dados do app). Sem fallback em texto puro.
- Fixtures apenas anonimizadas; nunca resposta real de conta.
- Erros mostrados ao usuário não vazam detalhes de conta; nada de logar payload sensível.
- Comandos de controle: um por vez, sem alteração otimista, sem repetição automática de POST; uma leitura confirma depois do envio.

## Convenções

- Interface em português, textos centralizados (preparando tradução futura).
- Cada operação carrega identidade de sessão e aparelho; respostas atrasadas de outra sessão/aparelho são descartadas.
- Estado confirmado ≠ alterações pendentes. Ausência de dado é "não informado" — nunca zero presumido.
- Controles só aparecem se anunciados no perfil do aparelho; capacidade ausente não é suposta.
- `electron/core/` não importa UI; a interface só fala com o processo principal pelo preload.
- Preserve o polling como rede de segurança: 20 s com painel visível; 5 min oculto, após erro ou quando o push em tempo real já provou o canal; pausa em suspensão. Abrir o painel (oculto → visível) força consulta na hora quando a última leitura tem mais de 10 s.
- Commits em português, mensagem direta (o porquê), mudanças pequenas; commit só depois da validação do usuário.

## Elgin (marco F)

Não assumir Tuya nem nenhum protocolo apenas pelo nome "Elgin Smart". Ordem obrigatória: identificar o modelo exato e o app/conta usados → investigar integração documentada ou outro caminho tecnicamente verificável → documentar suporte e limitações → só então implementar o adaptador, com os mesmos contratos de `shared/` e autenticação/capacidades próprias.
