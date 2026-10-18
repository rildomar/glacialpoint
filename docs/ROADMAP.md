# Plano de implementação

## Decisões aceitas

- Nome provisório: GlacialPoint; projeto independente inspirado no Celsius.
- Electron, React, TypeScript, Vite e Tailwind CSS.
- Windows primeiro; núcleo compartilhado e macOS posteriormente validado em hardware real.
- LG Dual Inverter/ThinQ primeiro. Elgin Smart depois de investigar o modelo e o mecanismo de integração.
- Interface em português; textos organizáveis para futura tradução.

## A — Prévia e base desktop

- [x] Painel interativo com LG simulado e Elgin identificado como futuro.
- [x] Temas claro/escuro, redução de movimento e transparência.
- [x] Separação de interface, preload, processo desktop e núcleo TypeScript.
- [x] Compilar e executar o Electron no Windows com os arquivos locais da interface.
- [ ] Verificar bandeja, foco, teclado, múltiplos monitores e escala de tela.
- [x] Revisar design com o usuário — mostrador circular interativo (o arco é o seletor) e card de consumo do dia (2026-10-18).

## B — LG real

Portar modelos, perfis, payloads e cliente HTTP do Celsius para TypeScript no processo desktop. Reaproveitar fixtures anonimizadas com atribuição. Separar estado confirmado de alterações pendentes. Interface só recebe informações necessárias; token entregue ao backend via IPC ao conectar, protegido pelo sistema, sem logs ou localStorage. Cada operação deve carregar identidade de sessão e aparelho; resultados antigos são descartados. Conectar conta, listar aparelhos, obter perfil/estado e ligar/desligar no LG do usuário.

Implementado: conexão por token, credencial criptografada, descoberta, perfil/estado e controles condicionados às capacidades. Testes de contrato, erros, cancelamento, interface e armazenamento Windows passaram. Validação com a conta e o aparelho do usuário: conexão validada em 2026-10-17 (`docs/LG.md`).

Aceite: operação real confirmada pelo aparelho e erros de autenticação/rede compreensíveis. Nunca registrar tokens nos testes ou screenshots.

## C — Paridade LG

Temperatura, modo, ventilação, oscilação, Eco e temporizador conforme capacidades. Fila serial por aparelho, agrupamento de comandos, debounce, confirmação, retries limitados com backoff e tratamento explícito de HTTP 429. Não presumir que capacidades ausentes são suportadas. Cancelamento ao desconectar/trocar aparelho. Polling reduzido em segundo plano; suspensão/retomada.

Aceite: testes com transporte/relógio falsos e validação real, incluindo troca de aparelho durante leitura/envio e respostas atrasadas.

Tempo real (2026-10-18): canal de push da nuvem da LG (MQTT sobre AWS IoT, certificado de cliente, assinatura de eventos renovada a cada 24 h) implementado em `electron/core/lg-push.ts`, com relatórios `DEVICE_STATUS` aplicados como leitura confirmada e o polling como rede de segurança. Pendente: validar ao vivo com o aparelho do usuário.

## D — Distribuição Windows

Identidade visual final, ícones, instalador, autostart opcional, instância única, consumo em repouso e verificação em diferentes escalas. Credenciais isoladas do Celsius. Definir atualização e assinatura para distribuição.

Instaladores prontos (2026-10-18): `npm run dist:win` gera NSIS (`.exe`) e MSI (WiX, com `upgradeCode` fixo — versão nova atualiza a instalação no lugar); `npm run dist:mac` gera o dmg no Mac; uma tag `v*` publica os dois em GitHub Releases pelo workflow do repositório. Pendente: assinatura de código, autostart, instância única, consumo em repouso e verificação em diferentes escalas.

## E — macOS

Compilar e testar em Mac, adequar menu bar, foco, posicionamento, Keychain, materiais nativos, suspensão e retomada. Definir assinatura/notarização. A compilação CI não substitui verificação de UX.

Estado (2026-10-18): o aplicativo compila e roda no Mac, com o Elgin testado ao vivo. Falta validar o LG (conexão, tempo real e Keychain) e revisar menu bar, foco e posicionamento. O dmg está configurado (`npm run dist:mac`) e também sai no workflow de release (arm64 e x64).

## F — Elgin

Identificar modelo exato e app/conta usados. Investigar integração documentada ou outra via tecnicamente verificável. Não assumir Tuya ou qualquer protocolo apenas pelo nome Elgin Smart. Documentar suporte e limitações antes de implementar. Adicionar adaptador com os mesmos contratos, mas capacidades e autenticação próprias.

Investigação concluída em 2026-10-17 (`docs/ELGIN.md`): plataforma Tuya; caminho B (reparear no Smart Life e vincular a conta ao projeto) com leitura e controle validados ao vivo. Núcleo implementado: contratos em `shared/elgin.ts`, cliente/sessão e push em tempo real em `electron/core/elgin-client.ts`, `elgin-session.ts` e `elgin-push.ts`, estimativa de consumo em `elgin-energy.ts`/`elgin-usage-store.ts`, credencial no `safeStorage` (`elgin-credential.bin`), fixtures anonimizadas e 32 testes (`npm run test:elgin`). Interface implementada em `ElginConnection.tsx`/`LiveElginPanel.tsx`, com abas LG/Elgin quando as duas contas estão conectadas, seletor de aparelhos e de integração no consumo, tutoriais de conexão no app e 7 casos de UI. Pendente: validação de um comando real pelo aplicativo e confirmação da faixa prática de temperatura.

## Próxima sessão

No Mac (marco E): atualizar o repositório, `npm ci` (dependências novas: `mqtt`, `@peculiar/x509`, `reflect-metadata`) e validar o LG — conexão, tempo real e Keychain; revisar bandeja/menu bar, foco e posicionamento; gerar o dmg (`npm run dist:mac`) e abrir o app por ele. Testar o instalador MSI no Windows (duplo clique) e conferir o aviso do SmartScreen. Validar um comando real do Elgin pelo aplicativo (efeito físico e leitura de volta) e confirmar a faixa prática de temperatura. Validar o tempo real do LG ao vivo: mudança pelo controle remoto deve aparecer no painel em ~1 s (se o selo mostrar "tempo real indisponível", gerar token novo com as permissões de eventos/push). Revisar a bandeja em diferentes monitores no Windows. Definir destino para pedidos de integração antes de habilitar envio; por enquanto, apenas rascunho local.

## Para depois

- Projeções de consumo: registro diário no aplicativo para projetar o mês e comparar com a fatura da concessionária, que cobra por média quando não há coleta no mês. Ideia do usuário (2026-10-17); fica para uma conversa futura.
