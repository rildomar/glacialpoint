# GlacialPoint

Seu clima, no ponto. Aplicativo desktop independente para controle de ar-condicionado, com interface inspirada no macOS Tahoe. Windows primeiro; macOS será validado depois.

## Estado atual

A versão desktop implementa a conexão LG ThinQ para contas do Brasil: token pessoal, descoberta de ar-condicionados, perfil, estado e comandos conforme os recursos do aparelho. A integração foi validada com fixtures e testes locais; a confirmação em hardware real ainda depende da conexão do usuário. O navegador continua sendo uma demonstração sem acesso a credenciais. Elgin (via Tuya Cloud) tem o adaptador de núcleo implementado e validado em leitura contra a API real; a interface e a validação de comando pelo aplicativo são o próximo passo.

O projeto usa Electron + React + TypeScript + Vite + Tailwind. O processo desktop é separado da interface por um preload com API limitada. Efeitos de vidro da prévia são CSS sobre uma paisagem gerada em CSS; desfoque do desktop e materiais nativos ainda precisam ser implementados e verificados. A aparência não é uma implementação nativa de Liquid Glass.

## Conectar seu LG ThinQ

1. Cadastre o ar-condicionado no aplicativo LG ThinQ e confirme que ele está acessível por lá.
2. Abra [o portal oficial de tokens](https://connect-pat.lgthinq.com/) com a mesma conta. Crie um token pessoal com permissão de consultar aparelhos, perfil/estado e enviar controles.
3. No aplicativo desktop, abra Configurações → LG ThinQ, cole o token no campo protegido e conecte. Escolha um dos aparelhos encontrados.

Não envie tokens em chats, arquivos do projeto ou screenshots. O token é entregue ao processo principal por IPC e salvo com Electron safeStorage (DPAPI no Windows), no arquivo lg-credential.bin da pasta de dados do aplicativo. Não há fallback em texto puro. Desconectar remove a credencial local; para revogá-la também na LG, use o portal. Esse armazenamento não protege contra outros programas executados sob a mesma conta Windows.

A região inicial é Brasil/Americas. A compatibilidade depende dos recursos que a API ThinQ disponibiliza para cada modelo. A interface mostra apenas controles anunciados no perfil e mantém dados ausentes como não informados. Os comandos são enviados um por vez, sem alteração otimista nem repetição automática de POST. Após o envio, uma leitura verifica a confirmação; falhas pedem atualização antes de tentar outra vez. Consultas automáticas: 20 segundos com painel visível, 5 minutos oculto ou após erro; pausam durante suspensão. Atualizar permite nova consulta manual. Agregação de comandos e suporte a outras regiões ficam para uma etapa posterior.

## Prévia no navegador

Requer Node.js compatível com Vite e npm.

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:1420. Teste temperaturas, modos, ligar/desligar, ventilação, oscilação, Eco e temporizador. Preferências e dados simulados ficam apenas na memória. O seletor mostra somente o aparelho demonstrativo LG; Elgin aparece apenas nas configurações. A caixa de sugestões salva um rascunho no armazenamento local e não envia pedidos. O canal de recebimento será definido antes de disponibilizar o envio.

```sh
npm run build
npm run test:e2e
```

Os testes da prévia usam Playwright com Microsoft Edge instalado. Verificam limites, controles desabilitados, estado ao alternar aparelhos/páginas e largura em tela pequena.

## Aplicativo desktop

Requer Node.js e npm. Esta versão não usa Rust nem módulos C++ próprios. O Electron traz o Chromium, sem depender do WebView2 do sistema.

```sh
npm run desktop:dev
```

A interface atualiza com Vite na porta 1421. Mudanças no processo Electron/preload exigem reiniciar esse comando. A prévia de navegador pode continuar na porta 1420.

Para rodar a interface compilada, sem servidor, use `npm run desktop:start`. O painel abre junto à bandeja, oculta ao perder foco, ao pressionar Escape ou ao fechar a janela. O menu da bandeja oferece Abrir e Sair. A janela se adapta à área útil do monitor. O aplicativo permite uma instância por perfil.

```sh
npm run build
npm run test:desktop
npm run test:lg
npm run package:win
```

O pacote fica em `release/win-unpacked/GlacialPoint.exe`; mantenha a pasta completa para executá-lo. `npm run dist:win` gera um instalador NSIS de desenvolvimento sem assinatura. Distribuição assinada e validação macOS são marcos futuros.

O teste desktop executa o Electron com os arquivos compilados e verifica o bridge, IPC, isolamento da interface, bloqueio de novas janelas e fechamento para a bandeja. O teste de desenvolvimento usa um perfil temporário separado. A configuração macOS existe, mas ainda precisa de execução e testes em Mac.

## Organização

- `src/`: interface e contrato inicial de aparelho; dados simulados explicitamente identificados.
- `electron/`: processo desktop, bandeja, janela e preload isolado.
- `electron/core/`: integrações e regras independentes da interface; clientes LG e Elgin (Tuya), validação de comandos e ciclo de sessão.
- `shared/`: contratos TypeScript compartilhados entre a interface e o processo desktop.
- `assets/`: ícones originais do GlacialPoint.
- `tests/`: cenários de interação do protótipo.
- `docs/ROADMAP.md`: marcos e critérios de entrega.

## Origem

O Celsius de Gabriel Villarinho é a referência da integração LG portada para TypeScript. Base examinada: `1bb0c66d137a13defbb3f6b41d82cfd4a02b23cb`, também presente no fork [rildomar/celsius](https://github.com/rildomar/celsius). Cliente, modelos e payloads foram adaptados; fixtures de perfil e estado foram reaproveitadas com atribuição. Consulte `THIRD_PARTY_NOTICES.md` e `licenses/Celsius-MIT.txt`.
## Consumo e tarifa

No desktop, o ícone de gráfico abre o consumo do aparelho selecionado. A tela consulta o perfil de energia e o histórico ThinQ (30 dias completos anteriores a hoje e seis meses incluindo o atual), no calendário de America/Sao_Paulo. Os valores retornados em Wh são convertidos para kWh. Ausências ficam como sem leitura; zero real continua sendo zero. O mês atual é parcial. O cache dura até cinco minutos e é descartado ao trocar sessão/aparelho; dados atrasados de sessões anteriores não são usados.

Configurações → Energia permite salvar uma tarifa em R$/kWh no arquivo energy-settings.json da pasta de dados do aplicativo. A tarifa começa vazia, é validada no processo principal e não é enviada à LG. O custo estimado usa a tarifa atual multiplicada pelo consumo mensal informado, sem cobranças fixas ou histórico de tarifas. Deixar o campo vazio remove a estimativa. O atalho no resumo de consumo abre a mesma configuração.

Validação: consultas reais de 30 dias e seis meses responderam com leituras para o LG conectado. Testes automatizados cobrem calendário, conversão Wh/kWh, dados ausentes, cache/cancelamento, persistência da tarifa e edição pela interface. Nenhum comando de controle foi enviado durante essa verificação.
