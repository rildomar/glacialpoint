import type { ReactNode } from 'react';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import { MockConsoleServices, MockPortalLogin, MockScan, MockTokenCreate } from './GuideMock';

function GuideStep({ n, title, action, visual, children }: { n: number; title: string; action?: ReactNode; visual?: ReactNode; children: ReactNode }) {
  return <div className="guide-step"><span className="guide-step-number">{n}</span><div><strong>{title}</strong><p>{children}</p>{action}{visual && <div className="guide-visual">{visual}</div>}</div></div>;
}

function GuideTips({ items }: { items: string[] }) {
  return <div className="guide-tip"><strong><CircleHelp size={12}/>Se algo der errado</strong><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div>;
}

export default function ConnectionGuide({ service, back, configure }: { service: 'lg' | 'elgin'; back: () => void; configure: () => void }) {
  const lg = window.glacialpoint?.lg;
  const elgin = window.glacialpoint?.elgin;
  const openPortal = () => { if (lg) void lg.openTokenPage(); };
  const openConsole = () => { if (elgin) void elgin.openConsolePage(); };
  if (service === 'lg') return <div className="guide-content">
    <button className="back-link" onClick={back}><ArrowLeft size={15}/>Voltar</button>
    <span className="energy-device">LG THINQ</span>
    <h2>Como conectar seu LG.</h2>
    <p className="energy-subtitle">Token pessoal, QR e dicas — o caminho completo.</p>
    <div className="guide-steps">
      <GuideStep n={1} title="Tenha o ar no aplicativo LG ThinQ">Confirme que o ar-condicionado já aparece e funciona no app LG ThinQ, com a mesma conta que você vai usar aqui.</GuideStep>
      <GuideStep n={2} title="Abra o portal de tokens da LG" action={<button className="lg-button" disabled={!lg} onClick={openPortal}>Abrir portal de tokens da LG ↗</button>} visual={<MockPortalLogin/>}>O portal é onde se cria o token pessoal que autoriza o GlacialPoint.</GuideStep>
      <GuideStep n={3} title="Entre na sua conta" visual={<MockScan caption="Câmera do celular" confirmation="ThinQ confirma a entrada"/>}>Com senha LG, entre normalmente. Conta criada pelo Google? Escolha a opção de entrar por QR e aponte a câmera do celular para o código: o aplicativo ThinQ confirma e a página entra sozinha.</GuideStep>
      <GuideStep n={4} title="Crie e copie o token" visual={<MockTokenCreate/>}>No portal, use ADD NEW TOKEN: dê um nome (ex.: glacialpoint), autorize consultar aparelhos, ler estado e enviar controles e confirme em CREATE. Copie o código que aparece — começa com thinqpat_.</GuideStep>
      <GuideStep n={5} title="Cole no GlacialPoint">Em Configurações → LG ThinQ, cole no campo "Token pessoal" e conecte. O token fica criptografado neste computador; não compartilhe.</GuideStep>
    </div>
    <GuideTips items={[
      'Erro de autorização no aplicativo: token de outra região ou de outra conta — gere com país Brasil, na mesma conta do ar.',
      'Portal que não carrega ou botão que não responde: bloqueadores de anúncio atrapalham; tente uma janela anônima sem extensões.',
      'QR expirado: gere outro e mantenha o aplicativo ThinQ aberto e logado no celular.',
    ]}/>
    <div className="guide-actions"><button className="lg-button primary" onClick={configure}>Configurar LG ThinQ</button></div>
  </div>;
  return <div className="guide-content">
    <button className="back-link" onClick={back}><ArrowLeft size={15}/>Voltar</button>
    <span className="energy-device">ELGIN SMART</span>
    <h2>Como conectar seu Elgin.</h2>
    <p className="energy-subtitle">O Elgin roda na plataforma Tuya — você liga a sua conta a um projeto gratuito.</p>
    <div className="guide-steps">
      <GuideStep n={1} title="Tenha o ar no aplicativo Smart Life">O vínculo funciona com contas do app Smart Life. Se o ar estiver apenas no app Elgin Smart, repareie o Wi-Fi (com o ar ligado, tecla IONAIR 8× até bipar) e cadastre no Smart Life — o controle móvel passa a ser por lá.</GuideStep>
      <GuideStep n={2} title="Crie um projeto na plataforma Tuya IoT" action={<button className="lg-button" disabled={!elgin} onClick={openConsole}>Abrir Tuya IoT ↗</button>}>Crie uma conta de desenvolvedor gratuita e um projeto do tipo Cloud. Escolha o datacenter da sua conta — no Brasil, Western America.</GuideStep>
      <GuideStep n={3} title="Ative os serviços do projeto" visual={<MockConsoleServices/>}>Em Cloud → My Services, confira o Smart Home Basic Service (ler e controlar aparelhos) e o Device Status Notification (atualizações em tempo real no painel).</GuideStep>
      <GuideStep n={4} title="Vincule sua conta Smart Life" visual={<MockScan caption="Leitor do Smart Life" confirmation="Conta vinculada ao projeto"/>}>No projeto, em Devices → Link App Account, adicione a conta e escaneie o QR com o aplicativo Smart Life. O ar deve aparecer na lista do projeto.</GuideStep>
      <GuideStep n={5} title="Copie as credenciais do projeto">Na visão geral do projeto, copie o Access ID e o Access Secret.</GuideStep>
      <GuideStep n={6} title="Preencha no GlacialPoint">Em Configurações → Elgin Smart, cole o Access ID e o Secret, confirme a região (Western America) e conecte. Tudo fica criptografado neste computador.</GuideStep>
    </div>
    <GuideTips items={[
      'O fluxo de vínculo pelo aplicativo Elgin Smart não completa — use o Smart Life.',
      'Região errada devolve erro de datacenter: projeto e conta precisam estar no mesmo datacenter (no Brasil, Western America).',
      'Se a leitura parar com o tempo, confira cotas e serviços autorizados em Cloud → My Services.',
    ]}/>
    <div className="guide-actions"><button className="lg-button primary" onClick={configure}>Configurar Elgin Smart</button></div>
  </div>;
}
