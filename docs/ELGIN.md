# Integração Elgin — investigação e plano

Marco F do ROADMAP. Estado: investigação em andamento — nada implementado; suporte e limitações em levantamento. O aparelho fica no escritório do usuário, então o requisito é **controle remoto via nuvem** (protocolo local de LAN não atende; pode virar melhoria futura para controle rápido no local).

## Aparelho do usuário

- Linha: Split High Wall **Eco Inverter III WiFi** (família HJ; "Eco 3").
- App de controle atual: **Elgin Smart** (`com.elgin.smart`).
- Módulo Wi-Fi da linha III: **TYAUX-J2** (conforme manual oficial da linha).

## Evidências sobre o backend

- O módulo TYAUX-J2 tem "Tuya" no nome; ficha de produto de varejo da linha (HJFC12C2WGCG) lista fabricante **"Hangzhou Tuya"**, modelo "TYAUX_J".
- Relato no Reddit (r/ArCondicionado): dono de Eco III pergunta por app alternativo; resposta da comunidade: **"Tuya / Smartlife"**.
- Relato no Fórum Home Assistant Brasil: ar-condicionado Elgin integrado pareando o aparelho no app **Smart Life** (mesma plataforma Tuya) e usando Tuya Local/Tuya oficial.
- Contraste importante: a linha anterior (Eco Inverter II, app **Elgin Air** — pacote `cn.com.auxgroup...`) tem integração comunitária de Home Assistant apontando backend **AUX Cloud/Broadlink**. Há sobreposição de relatos sobre módulos TYAUX-J/J2 entre as gerações — mais um motivo para não assumir sem teste.

**Confirmado na prática:** o app Elgin Smart reconheceu o QR de vínculo da plataforma Tuya e pediu confirmação — a linha roda na **plataforma Tuya**. O vínculo em si falhou por **datacenter**: contas de apps OEM são servidas por datacenters diferentes das do app Smart Life (para apps OEM, Brasil → **Eastern America**; para Smart Life/Tuya Smart, Brasil → Western America). O projeto havia sido criado em Western America, e por isso o vínculo foi recusado. A região da conta aparece no app em: Eu → Configurações → Conta e Segurança → Região.

## Caminhos avaliados

| Caminho | O que é | Custo/risco |
|---|---|---|
| **A — Vincular conta ao projeto Tuya IoT** | Criar um projeto na plataforma de desenvolvedor Tuya e usar o fluxo "Link App Account" (QR) com o app Elgin Smart. Não invasivo: o aparelho continua no app | Depende do app Elgin Smart aceitar o fluxo de vínculo; se aceitar, é o melhor cenário |
| **B — Reparear no app Smart Life** | Resetar o Wi-Fi do aparelho no escritório e cadastrá-lo no Smart Life; depois vincular ao projeto Tuya IoT | Caminho documentado pela comunidade; exige acesso físico e o controle móvel sai do app Elgin Smart (um aparelho vive em uma conta por vez) |
| **C — Controle local (tinytuya)** | Falar direto com o módulo na rede local | Descartado por ora: exige estar na rede do escritório e extrair local key; não atende o controle remoto |

## Limitações esperadas (a confirmar na prática)

- Projeto Tuya com serviço de nuvem (verificar expiração de trial e cotas de chamadas).
- Região/datacenter do projeto precisa corresponder à do app/da conta.
- Comportamentos de sessão única entre app móvel e integração.
- Um aparelho pertence a uma conta por vez — o caminho B move o controle móvel para o Smart Life.

## Próximos passos

1. Caminho A (em andamento): o app reconheceu o QR de vínculo, mas o projeto estava no datacenter errado (Western America). Recriar o projeto Tuya em **Eastern America** (mapeamento de apps OEM para Brasil), repetir o vínculo e conferir a lista de aparelhos.
2. Se A falhar: agendar o repareamento no Smart Life (caminho B) em ida ao escritório.
3. Com o backend confirmado: adaptador em `electron/core/` (cliente Elgin) com os mesmos contratos de `shared/`, credenciais no `safeStorage`, capacidades lidas do perfil do aparelho e fila serial de comandos como no LG.
4. Fixtures anonimizadas para os testes.

## Referências

- Manual Wi-Fi Eco Inverter III (módulo TYAUX-J2): `leverosintegra.com.br/download/manuais/Elgin/manual-instrucoes-wifi-elgin-eco-inverter-iii-wifi-12k.pdf`
- Ficha de produto com fabricante "Hangzhou Tuya": `efacil.com.br` (HJFC12C2WGCG)
- Reddit r/ArCondicionado — thread do Eco III ("Tuya / Smartlife")
- Fórum Home Assistant Brasil — repareamento via Smart Life
- Integração comunitária da linha II (AUX Cloud): `github.com/asnunes/ha-elgin-air-hjfc` (fork de `maeek/ha-aux-cloud`)
- Tuya — mapeamento de contas de apps OEM para datacenters: `developer.tuya.com/en/docs/iot/oem-app-data-center-distributed`
