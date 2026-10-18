# Post de divulgação (LinkedIn)

Texto do post de lançamento da 0.1.1. A menção `@Gabriel Villarinho` precisa ser refeita no editor do LinkedIn (texto colado não vira menção). O vídeo e as imagens desta pasta usam a prévia do app com dados simulados.

```text
Nesse fim de semana tirei um projeto da cabeça: um app desktop pra controlar o ar-condicionado aqui de casa.

Ele nasceu do Celsius, do @Gabriel Villarinho. É um app nativo em Swift que controla o ar LG pela barra de menus do Mac. Achei a ideia muito boa.. só que o meu dia a dia é no Windows.

Então, em vez de esperar uma versão pra Windows, resolvi portar. E aí veio a decisão que mais pesou: sair do Swift e fazer em Electron.

O motivo foi bem prático. Com Electron eu tenho um código só pra Windows e macOS. O núcleo (cliente da LG, validação de comandos, sessão) ficou em TypeScript puro, separado da interface por um preload com o mínimo de API. Dá pra testar tudo no Node sem abrir janela nenhuma. E como o Chromium já vem junto, a interface fica igual nas duas plataformas, sem depender do WebView do sistema.

Tem custo, claro. O instalador fica maior e o app usa mais memória que um nativo. Pra um painel de bandeja eu aceitei a troca, porque o objetivo era chegar no Windows sem manter dois códigos.

No caminho entrou também o Elgin Smart, que é o ar do meu escritório. E foi aqui que mais demorou.

A Elgin não tem API documentada, então fui investigando. Testei o próprio app Elgin Smart pra vincular a conta e o fluxo não completava. Até que tivemos que olhar a etiqueta física do aparelho pra descobrir quem fornece o módulo de Wi-Fi.. e era a Tuya. A partir daí foi parear no app Smart Life, vincular a conta num projeto da Tuya e usar a API oficial deles. Virou a segunda integração.

O que ele faz hoje:
- LG ThinQ e Elgin Smart direto nas nuvens oficiais, sem servidor no meio
- tempo real em cerca de 1 s via MQTT: mudou no celular ou no controle, aparece no painel
- mostrador circular, o próprio arco escolhe a temperatura
- só aparecem os controles que o aparelho anuncia
- um comando por vez, sem atualização otimista, e uma leitura confirma depois do envio
- credenciais criptografadas no cofre do sistema

A tela de consumo foi um bônus. A LG já guarda o histórico, então o app mostra os últimos 30 dias, os últimos 6 meses e o custo estimado com a tarifa em R$/kWh. No Elgin, que não mede energia, ele estima pelo tempo ligado.

São mais de 70 testes automatizados e os instaladores saem pelo GitHub Actions. No Mac já roda, falta validar a parte da LG por lá.

A versão 0.1.1 já está publicada, com instalador pra Windows (.exe e MSI) e macOS (Apple Silicon e Intel):
github.com/rildomar/glacialpoint/releases/latest

Ainda não tenho certificado de assinatura pro Windows e pro Mac, então a instalação vai mostrar um alerta. Mas o código está aberto pra quem quiser avaliar.

O cliente da LG é uma adaptação do trabalho do Gabriel, com atribuição e licença MIT mantidas. Valeu por abrir o código, Gabriel.

Código aberto: github.com/rildomar/glacialpoint
Projeto original: github.com/gbvillarinho/celsius

E vocês, teriam ido de Electron ou de outra coisa, tipo Tauri ou nativo mesmo? Faz sentido essa troca pra vocês?

#Electron #TypeScript #OpenSource #IoT
```
