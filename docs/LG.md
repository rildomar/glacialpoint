# Integração LG ThinQ — conexão e token

Estado: **conexão validada em 2026-10-17** (conta criada via Google — rota do QR com a câmera do celular, abaixo) e em uso com a conta do usuário. Este documento é a base do passo a passo dentro do aplicativo (Configurações → LG ThinQ → "Passo a passo de conexão").

O GlacialPoint fala direto com a API oficial da LG (região Brasil) usando um **token pessoal** da própria conta ThinQ. O token substitui a senha: o aplicativo nunca pede nem guarda a senha da LG.

## O que o aplicativo faz com o token

- Lista os ar-condicionados da conta e mostra um por vez — com seletor quando há mais de um (a escolha fica lembrada).
- Lê o perfil do modelo e monta os controles **só com o que o aparelho anuncia**: ligar/desligar, modos (resfriar, secar, ventilar, auto), temperatura alvo, velocidades de ventilação, oscilação, Eco e temporizador/sono. Capacidades variam por modelo.
- Envia um comando por vez, **sem alteração otimista**; depois do envio, uma leitura confirma o novo estado. Falha pede atualização antes de tentar de novo.
- Recebe mudanças **em tempo real** pelo canal de push da nuvem da LG (MQTT; ~1 s, inclusive as feitas por fora — controle remoto, aplicativo ThinQ, agendamentos). O selo do painel mostra "conectando tempo real…", "tempo real ativo" ou "tempo real indisponível" (token sem permissão de eventos/push ou modelo sem suporte).
- Mantém o polling como rede de segurança: 20 s com o painel visível, 5 min oculto ou após erro — e 5 min quando o tempo real já provou o canal; pausam durante a suspensão do computador. O botão Atualizar força uma consulta na hora, e abrir o painel já consulta quando a última leitura tem mais de 10 s.
- Consulta o **histórico de energia** do ThinQ (30 dias completos mais seis meses, incluindo o atual, no calendário de America/Sao_Paulo) para a tela de consumo. Valores em Wh viram kWh; ausências ficam como "sem leitura".

## Pré-requisitos

- O ar-condicionado precisa estar cadastrado e funcionando no aplicativo **LG ThinQ**, na mesma conta que vai gerar o token.
- Use uma conta da região **Brasil** (se o portal pedir país, escolha Brasil). O aplicativo consulta a API brasileira (cabeçalho `x-country: BR`); token de outra região falha com `token_unauthorized`.
- No computador, use o navegador **sem bloqueadores de anúncio nem extensões** durante a geração — a página do portal é sensível a isso.
- Para a rota do QR (contas via Google/Apple/SSO): mantenha o **aplicativo LG ThinQ aberto e logado** no celular, com os termos aceitos.

## Gerar o token

O portal é o mesmo que o aplicativo abre no botão **"Abrir portal de tokens da LG"**: https://connect-pat.lgthinq.com/

### Conta com senha LG (rota direta)

1. Entre com o ID (e-mail) e a senha da conta LG.
2. **ADD NEW TOKEN** → dê um nome (ex.: `glacialpoint`).
3. Autorize a consulta de aparelhos, a leitura de perfil/estado, o envio de controles e as permissões de **eventos/notificações** (o tempo real do painel).
4. **CREATE** e copie o token gerado — ele começa com `thinqpat_`.

### Conta criada via Google/SSO (rota do QR — a que usamos)

Contas sociais não têm senha LG para digitar no portal; o login por senha não se aplica. O caminho que funcionou:

1. Abra o portal (link acima) e escolha a opção de entrar **por QR/código** (fica junto do campo de ID, na tela de login).
2. No celular, abra a **câmera** comum (não o aplicativo da LG) e aponte para o QR exibido na tela do computador.
3. O celular abre o **aplicativo LG ThinQ** já logado; confirme a autorização.
4. A sessão no computador entra sozinha na conta.
5. Gere e copie o token como na rota direta (ADD NEW TOKEN → nome → permissões, incluindo eventos/notificações → CREATE).

## Colocar no GlacialPoint

1. Configurações → **LG ThinQ** → cole o token no campo "Token pessoal" e clique em **Conectar LG ThinQ**.
2. O token é guardado criptografado pelo Windows (Electron safeStorage/DPAPI) no arquivo `lg-credential.bin` da pasta de dados do aplicativo — nunca em texto puro nem no armazenamento da interface.
3. Os aparelhos da conta aparecem para escolha; o aplicativo controla apenas o que cada modelo anuncia.

## Renovar ou revogar

- Se o aplicativo passar a recusar a conexão, gere um token novo no portal e conecte de novo. A LG pode revogar tokens a qualquer momento.
- **Desconectar** no aplicativo apaga a cópia local. Para revogar também na conta, apague o token no portal.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "login failed" na página | conta é Google/SSO (sem senha LG) | use a rota do QR da câmera |
| QR expira ou não abre o aplicativo | janela demorou / sessão deslogada | gere um QR novo; confirme sessão e termos no aplicativo ThinQ (sair e entrar de novo se preciso) |
| Página não carrega ou botões mortos | bloqueador de anúncios/extensão | repita em janela anônima sem extensões |
| `token_unauthorized` no aplicativo | token de outra região ou de outra conta | gere com país Brasil, na mesma conta do aparelho |
| Conecta, mas não lista o ar | aparelho não está nessa conta do LG ThinQ | confira no aplicativo LG ThinQ qual conta tem o aparelho |
| Selo "tempo real indisponível" no painel | token sem as permissões de eventos/push (ou modelo antigo) | gere um token novo com todas as permissões no portal e reconecte; sem tempo real o painel segue atualizando por consulta |

## Segurança

- O token vale como uma senha da conta (só para a API): não cole em chats, capturas de tela, issues ou no repositório.
- No GlacialPoint ele fica apenas no processo principal, protegido pelo sistema; a interface não guarda o token.
- Esse armazenamento não protege contra outros programas executados sob a mesma conta do Windows (mesma ressalva do README).

## Testes

- `npm run test:lg` — 23 casos de núcleo (node): validação do token, descoberta de aparelhos, perfil/estado, montagem de comandos, canal de tempo real (rota, certificado, assinaturas, renovação e bloqueios), energia e tarifa.
- `npm run test:e2e` — casos de interface cobrindo o formulário de token, os controles conforme a capacidade anunciada e a alternância entre integrações.
- `npm run test:desktop` — ponte nativa e armazenamento seguro no Electron compilado.

## Notas internas (implementação)

- Cliente HTTP em `electron/core/lg-client.ts` (fala com `https://api-aic.lgthinq.com/`, cabeçalhos `x-country: BR` e `x-client-id` do ThinQ) e ciclo de sessão em `electron/core/lg-session.ts`.
- Canal de tempo real em `electron/core/lg-push.ts`: MQTT com certificado de cliente emitido pela LG (chave RSA 2048 + CSR `CN=lg_thinq` → `POST /client/certificate`), assinatura de eventos renovada a cada 24 h e relatórios `DEVICE_STATUS` aplicados como leitura confirmada. Mesma arquitetura da integração oficial do Home Assistant, com base na biblioteca da própria LG [`thinqconnect`](https://github.com/thinq-connect/pythinqconnect) (Apache-2.0); a CA raiz da Amazon vai embutida no módulo.
- O token precisa começar com `thinqpat_` (validado antes de salvar) e é guardado via safeStorage em `lg-credential.bin`, na pasta de dados do aplicativo; a interface recebe apenas snapshots sem o token.
- O botão "Abrir portal de tokens da LG" (Configurações e tutorial) abre `https://connect-pat.lgthinq.com/` por IPC (`lg:token-page`).
- Consultas automáticas (rede de segurança): 20 s com o painel visível, 5 min oculto ou após erro — e 5 min sempre que o canal de tempo real já entregou leitura; pausam durante a suspensão. Agrupamento de comandos e outras regiões ficam para uma etapa posterior.
