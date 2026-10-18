# Integração LG ThinQ — conexão e token

Estado: **conexão validada em 2026-10-17**, incluindo conta criada via Google (rota do QR com a câmera do celular, abaixo). Este documento é a base do passo a passo dentro do aplicativo (Configurações → LG ThinQ → "Passo a passo de conexão").

O GlacialPoint fala direto com a API oficial da LG (região Brasil) usando um **token pessoal** da própria conta ThinQ. O token substitui a senha: o aplicativo nunca pede nem guarda a senha da LG.

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
3. Autorize a consulta de aparelhos, a leitura de perfil/estado e o envio de controles.
4. **CREATE** e copie o token gerado — ele começa com `thinqpat_`.

### Conta criada via Google/SSO (rota do QR — a que usamos)

Contas sociais não têm senha LG para digitar no portal; o login por senha não se aplica. O caminho que funcionou:

1. Abra o portal (link acima) e escolha a opção de entrar **por QR/código** (fica junto do campo de ID, na tela de login).
2. No celular, abra a **câmera** comum (não o aplicativo da LG) e aponte para o QR exibido na tela do computador.
3. O celular abre o **aplicativo LG ThinQ** já logado; confirme a autorização.
4. A sessão no computador entra sozinha na conta.
5. Gere e copie o token como na rota direta (ADD NEW TOKEN → nome → permissões → CREATE).

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

## Segurança

- O token vale como uma senha da conta (só para a API): não cole em chats, capturas de tela, issues ou no repositório.
- No GlacialPoint ele fica apenas no processo principal, protegido pelo sistema; a interface não guarda o token.
- Esse armazenamento não protege contra outros programas executados sob a mesma conta do Windows (mesma ressalva do README).

## Notas internas (implementação)

- Botão do aplicativo abre `https://connect-pat.lgthinq.com/` (IPC `lg:token-page`).
- Cliente fala com `https://api-aic.lgthinq.com/` com `x-country: BR` e `x-client-id` do ThinQ; o token precisa começar com `thinqpat_` (validado antes de salvar).
- Credencial salva via safeStorage em `lg-credential.bin` na pasta de dados; a interface recebe apenas snapshots sem o token.
- Consultas automáticas: 20 s com o painel visível, 5 min oculto ou após erro; pausam durante a suspensão.
