# Integração Elgin — investigação e plano

Marco F do ROADMAP. Estado: investigação em andamento — nada implementado; suporte e limitações em levantamento. O aparelho fica no escritório do usuário, então o requisito é **controle remoto via nuvem** (protocolo local de LAN não atende; pode virar melhoria futura para controle rápido no local).

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

**Plataforma confirmada na prática:** o app Elgin Smart reconheceu o QR de vínculo da plataforma Tuya e pediu confirmação — a linha roda na **plataforma Tuya**. O vínculo em si, porém, **não completa**: o app confirma mas a autorização nunca chega ao console (o QR passa a "has expired" com aviso de datacenter). Testado com projetos em **Western America** e em **Eastern America** (região da conta: Brasil) — mesmo resultado nos dois. Hipótese atual: o fluxo oficial "Link Tuya App Account" é documentado para contas dos apps **Tuya Smart / Smart Life**; a conta do app OEM não completa a autorização (sintoma igual relatado para outros apps OEM). Região da conta no app: Eu → Configurações → Conta e Segurança → Região.

## Caminhos avaliados

| Caminho | O que é | Custo/risco |
|---|---|---|
| **A — Vincular conta ao projeto Tuya IoT** | Criar um projeto na plataforma de desenvolvedor Tuya e usar o fluxo "Link App Account" (QR) com o app Elgin Smart. Não invasivo: o aparelho continua no app | **Testado: não completa** — o app OEM reconhece e confirma o QR, mas a autorização não chega ao console (testado em Western e Eastern America). O fluxo "Link Tuya App Account" é documentado para contas Tuya Smart/Smart Life |
| **B — Reparear no app Smart Life** | Resetar o Wi-Fi do aparelho (com o ar ligado, tecla IONAIR 8× no controle → 2 bipes) e cadastrá-lo no Smart Life; depois vincular ao projeto Tuya IoT | Caminho documentado pela comunidade; exige acesso físico e o controle móvel sai do app Elgin Smart (um aparelho vive em uma conta por vez). **Em execução** |
| **C — Controle local (tinytuya)** | Falar direto com o módulo na rede local | Descartado por ora: exige estar na rede do escritório e extrair local key; não atende o controle remoto |

## Limitações esperadas (a confirmar na prática)

- Projeto Tuya com serviço de nuvem (verificar expiração de trial e cotas de chamadas).
- Região/datacenter do projeto precisa corresponder à do app/da conta.
- Comportamentos de sessão única entre app móvel e integração.
- Um aparelho pertence a uma conta por vez — o caminho B move o controle móvel para o Smart Life.

## Próximos passos

1. Caminho B (iniciado em ida ao escritório): reinstalar o aparelho no app **Smart Life** — remover do Elgin Smart, resetar o Wi-Fi (ar ligado; tecla IONAIR 8× no controle → 2 bipes), parear em modo EZ (rede 2,4 GHz) e validar o controle no app.
2. Vincular a conta do Smart Life a um projeto Tuya IoT: tentar primeiro **Western America** (mapeamento das contas Smart Life) e, se o aviso de datacenter aparecer, **Eastern America** (os dois projetos já existem).
3. Sonda de leitura via Tuya OpenAPI (listar aparelho e ler status) — credenciais do projeto em arquivo local com permissão restrita, fora do repositório.
4. Adaptador em `electron/core/` (cliente Elgin) com os mesmos contratos de `shared/`, credenciais no `safeStorage`, capacidades lidas do perfil do aparelho e fila serial de comandos como no LG.
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
