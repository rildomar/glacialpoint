import { useEffect, useState } from 'react';
import { ArrowLeft, ChartNoAxesColumn, Check, CircleHelp, Droplets, Fan, Leaf, Moon, Power, SlidersHorizontal, Snowflake, Sparkles, Sun, Waves, Wind, X } from 'lucide-react';
import ConnectionGuide from './ConnectionGuide';
import EnergyPanel from './EnergyPanel';
import EnergySettings from './EnergySettings';
import ElginConnection from './ElginConnection';
import LiveElginPanel from './LiveElginPanel';
import LGConnection from './LGConnection';
import LiveLGPanel from './LiveLGPanel';
import TemperatureDial from './TemperatureDial';
import { emptyElgin, type ElginSnapshot } from '../shared/elgin';
import { emptyLG, type LGSnapshot } from '../shared/lg';
import IntegrationSuggestion from './IntegrationSuggestion';
import { demoDevice, initialDemoState, type DeviceState, type FanSpeed, type Mode } from './domain';

const modes = [
  { id: 'cool', label: 'Resfriar', icon: Snowflake },
  { id: 'dry', label: 'Secar', icon: Droplets },
  { id: 'fan', label: 'Ventilar', icon: Wind },
  { id: 'auto', label: 'Auto', icon: Sparkles },
] as const;
const activity: Record<Mode, string> = { cool: 'Resfriando o ambiente', dry: 'Reduzindo a umidade', fan: 'Uma brisa leve', auto: 'Clima no ponto' };
const speedLabels: Record<FanSpeed, string> = { auto: 'Auto', low: 'Baixa', medium: 'Média', high: 'Alta' };

export default function App() {
  const [state, setState] = useState<DeviceState>(initialDemoState);
  const [page, setPage] = useState<'control' | 'settings' | 'energy' | 'tariff' | 'guide'>('control');
  const [tariffReturn, setTariffReturn] = useState<'settings' | 'energy'>('energy');
  const configureTariff = (from: 'settings' | 'energy') => { setTariffReturn(from); setPage('tariff'); };
  const [guideService, setGuideService] = useState<'lg' | 'elgin'>('lg');
  const [guideReturn, setGuideReturn] = useState<'control' | 'settings'>('settings');
  const openGuide = (service: 'lg' | 'elgin', from: 'control' | 'settings') => { setGuideService(service); setGuideReturn(from); setPage('guide'); };
  const [light, setLight] = useState(false);
  const [solid, setSolid] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const desktop = window.glacialpoint?.isDesktop === true;
  const [lg, setLG] = useState<LGSnapshot>(emptyLG);
  const [elgin, setElgin] = useState<ElginSnapshot>(emptyElgin);
  // Preferência de integração ativa; só vale quando as duas estão conectadas.
  const [provider, setProvider] = useState<'lg' | 'elgin'>(() => {
    try { return localStorage.getItem('glacialpoint.provider') === 'elgin' ? 'elgin' : 'lg'; } catch { return 'lg'; }
  });
  const chooseProvider = (value: 'lg' | 'elgin') => {
    setProvider(value);
    try { localStorage.setItem('glacialpoint.provider', value); } catch { /* preferência não é essencial */ }
  };
  const active: 'lg' | 'elgin' = provider === 'elgin'
    ? (elgin.connected || !lg.connected ? 'elgin' : 'lg')
    : (lg.connected || !elgin.connected ? 'lg' : 'elgin');
  const activeConnected = active === 'lg' ? lg.connected : elgin.connected;
  const activeBusy = active === 'lg' ? lg.busy : elgin.busy;
  const activeNotice = active === 'lg' ? lg.notice : elgin.notice;
  const activeSelectedId = active === 'lg' ? lg.selectedId : elgin.selectedId;
  const activeDeviceName = (active === 'lg' ? lg.devices : elgin.devices).find(device => device.id === activeSelectedId)?.name;
  const activeDevices = active === 'lg' ? lg.devices : elgin.devices;
  useEffect(() => {
    const bridge = window.glacialpoint?.lg;
    if (!bridge) return;
    let mounted = true;
    let received = false;
    const unsubscribe = bridge.subscribe(value => { received = true; if (mounted) setLG(value); });
    void bridge.snapshot().then(value => { if (mounted && !received) setLG(value); }).catch(() => { if (mounted) setLG(s => ({ ...s, error: 'Não foi possível iniciar a conexão LG.' })); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const bridge = window.glacialpoint?.elgin;
    if (!bridge) return;
    let mounted = true;
    let received = false;
    const unsubscribe = bridge.subscribe(value => { received = true; if (mounted) setElgin(value); });
    void bridge.snapshot().then(value => { if (mounted && !received) setElgin(value); }).catch(() => { if (mounted) setElgin(s => ({ ...s, error: 'Não foi possível iniciar a conexão Elgin.' })); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const update = <K extends keyof DeviceState>(key: K, value: DeviceState[K]) => setState(s => ({ ...s, [key]: value }));
  const temperatureEnabled = state.power && (state.mode === 'cool' || state.mode === 'auto');
  const target = (value: number) => update('target', Math.max(demoDevice.capabilities.min, Math.min(demoDevice.capabilities.max, value)));

  return <div className={`scene ${light ? 'light' : ''} ${solid ? 'solid' : ''} ${reducedMotion ? 'still' : ''} ${desktop ? 'desktop' : ''}`}>
    <div className="landscape" aria-hidden="true"><div className="sky-glow"/><div className="ridge ridge-back"/><div className="ridge ridge-front"/><div className="water"/></div>
    {!desktop && <header className="preview-header"><div className="flex items-center gap-3"><span className="brand-mark"><Snowflake size={22}/></span><span className="brand-name">GlacialPoint<span className="brand-sub">SEU CLIMA, NO PONTO.</span></span></div><span className="preview-label">DESIGN PREVIEW <span>01</span></span></header>}
    <main className="stage">
      {!desktop && <div className="intro"><span className="eyebrow">UM RESPIRO NO SEU DIA</span><h1>O seu clima.<br/>No seu controle.</h1><p>Um lugar tranquilo para encontrar<br/>a temperatura perfeita.</p><div className="intro-line"/><span className="intro-note">Inspirado na leveza. Feito para o seu desktop.</span></div>}
      <section className="panel" aria-label="Painel GlacialPoint">
        <header className="panel-header" inert={desktop && activeBusy && !!activeNotice}><div className="flex items-center gap-2"><Snowflake size={19}/><span>GlacialPoint</span></div><div className="flex gap-1">{desktop && (activeConnected || page === 'energy') && <button className="icon-button" aria-label={page === 'energy' ? 'Voltar aos controles' : 'Abrir consumo'} onClick={() => setPage(page === 'energy' ? 'control' : 'energy')}><ChartNoAxesColumn size={17}/></button>}<button className="icon-button" aria-label={light ? 'Ativar tema escuro' : 'Ativar tema claro'} onClick={() => setLight(!light)}>{light ? <Moon size={17}/> : <Sun size={17}/>}</button><button className="icon-button" aria-label={page === 'settings' ? 'Voltar aos controles' : 'Abrir configurações'} onClick={() => setPage(page === 'settings' ? 'control' : 'settings')}>{page === 'settings' ? <X size={17}/> : <SlidersHorizontal size={17}/>}</button></div></header>
        <div className="demo-banner"><span className="demo-dot"/>{desktop ? active === 'lg' ? 'LG ThinQ' : 'Elgin Smart' : 'Demonstração'}<span>{desktop ? activeConnected ? 'Conta conectada' : 'Configure sua conta' : 'Sem conexão com aparelhos'}</span></div>
        {page === 'guide' ? <ConnectionGuide service={guideService} back={() => setPage(guideReturn)} configure={() => setPage('settings')}/> : page === 'energy' && desktop ? <EnergyPanel key={`${active}:${activeSelectedId ?? 'none'}`} provider={active} deviceId={activeConnected ? activeSelectedId : null} deviceName={activeDeviceName} back={() => setPage('control')} tariffSettings={() => configureTariff('energy')} integrations={lg.connected && elgin.connected ? { active, select: chooseProvider } : null} devices={activeDevices.length > 1 ? { list: activeDevices, selectedId: activeSelectedId, select: id => { const bridge = window.glacialpoint; void (active === 'lg' ? bridge!.lg.select(id) : bridge!.elgin.select(id)).catch(() => { /* o painel segue no aparelho atual */ }); } } : null}/> : page === 'tariff' && desktop ? <EnergySettings back={() => setPage(tariffReturn)}/> : page === 'settings' ? <div className="settings-content">
          <button className="back-link" onClick={() => setPage('control')}><ArrowLeft size={15}/>Voltar</button>
          <h2>Do seu jeito.</h2><p className="muted settings-description">Ajustes simples para um clima melhor.</p>
          <h3 className="section-label">APARÊNCIA</h3>
          <Setting label="Tema claro" detail="Alternar a aparência do painel" checked={light} onChange={() => setLight(!light)}/>
          <Setting label="Reduzir transparência" detail="Um fundo sólido para facilitar a leitura" checked={solid} onChange={() => setSolid(!solid)}/>
          <Setting label="Reduzir movimento" detail="Desativar as animações decorativas" checked={reducedMotion} onChange={() => setReducedMotion(!reducedMotion)}/>
          <h3 className="section-label mt-7!">ENERGIA</h3>{desktop && <button className="lg-button" onClick={() => configureTariff('settings')}>Configurar tarifa de energia</button>}<h3 className="section-label mt-7!">INTEGRAÇÕES</h3>
          <LGConnection snapshot={lg} guide={() => openGuide('lg', 'settings')}/>
          <ElginConnection snapshot={elgin} onConnected={() => chooseProvider('elgin')} guide={() => openGuide('elgin', 'settings')}/>
          <IntegrationSuggestion />
          <p className="settings-footnote">As preferências de aparência duram até fechar o aplicativo.</p>
        </div> : desktop ? <>
          {lg.connected && elgin.connected && <div className="device-tabs provider-tabs" role="group" aria-label="Integrações conectadas"><button aria-pressed={active === 'lg'} onClick={() => chooseProvider('lg')}>LG ThinQ</button><button aria-pressed={active === 'elgin'} onClick={() => chooseProvider('elgin')}>Elgin Smart</button></div>}
          {active === 'lg' ? <LiveLGPanel snapshot={lg} configure={() => setPage('settings')} guide={() => openGuide('lg', 'control')}/> : <LiveElginPanel snapshot={elgin} configure={() => setPage('settings')} guide={() => openGuide('elgin', 'control')}/>}
        </> : <>
          <div className="device-tabs" role="group" aria-label="Aparelhos da demonstração"><button aria-pressed="true"><span className="device-led selected"/>{demoDevice.name}</button></div>
          <div className={`controls ${state.power ? 'powered' : ''}`}>
            <div className="device-heading"><div><span className="section-label">{demoDevice.room}</span><h2>{demoDevice.name}</h2></div><button className={`power-button ${state.power ? 'on' : ''}`} aria-label={state.power ? 'Desligar aparelho simulado' : 'Ligar aparelho simulado'} aria-pressed={state.power} onClick={() => update('power', !state.power)}><Power size={22}/></button></div>
            <TemperatureDial min={demoDevice.capabilities.min} max={demoDevice.capabilities.max} step={demoDevice.capabilities.step} target={state.target} power={state.power} status={state.power ? activity[state.mode] : 'Aparelho desligado'} disabled={!temperatureEnabled} onSelect={target}/>
            <div className="dial-readout"><span className="dial-readout-label">AMBIENTE</span><span className="dial-ambient-value">26<span className="degree">°</span></span></div>
            <fieldset disabled={!state.power} className="mode-fieldset"><legend className="section-label">MODO</legend><div className="mode-grid">{modes.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={state.mode === id} className={state.mode === id ? 'active' : ''} onClick={() => update('mode', id)}><Icon size={20}/><span>{label}</span></button>)}</div></fieldset>
            <fieldset disabled={!state.power} className="extras-fieldset"><legend className="sr-only">Controles adicionais</legend><div className="fan-row"><div className="flex items-center gap-2"><Fan size={17}/><span>Ventilação</span></div><div className="fan-segments" role="radiogroup" aria-label="Velocidade da ventilação">{Object.entries(speedLabels).map(([value, label]) => <label key={value}><input type="radio" name="fan-speed" value={value} checked={state.fan === value} onChange={() => update('fan', value as FanSpeed)}/><span>{label}</span></label>)}</div></div><div className="extras-grid"><button aria-pressed={state.swing} onClick={() => update('swing', !state.swing)}><Waves size={19}/><span>Oscilar</span><span className={`mini-indicator ${state.swing ? 'active' : ''}`}>{state.swing ? <Check size={10}/> : null}</span></button><button aria-pressed={state.eco} onClick={() => update('eco', !state.eco)}><Leaf size={19}/><span>Eco</span><span className={`mini-indicator ${state.eco ? 'active' : ''}`}>{state.eco ? <Check size={10}/> : null}</span></button><label className="sleep-control"><Moon size={19}/><span>Dormir</span><select aria-label="Temporizador de desligamento" value={state.sleepHours} onChange={e => update('sleepHours', Number(e.target.value))}><option value="0">Desativado</option>{[1,2,3,4,5,6,7].map(h => <option key={h} value={h}>{h} h</option>)}</select></label></div></fieldset>
            <div className="ambient"><span>Dados simulados</span></div>
          </div>
        </>}
        <footer className="panel-footer"><span className="flex items-center gap-1.5"><CircleHelp size={11}/>{desktop ? active === 'lg' ? 'LG ThinQ · Brasil' : 'Elgin Smart · Tuya Cloud' : 'Prévia interativa'}</span><span>GlacialPoint · 0.1</span></footer>
        {desktop && activeBusy && activeNotice && <div className="command-overlay" role="status" aria-live="polite"><div className="command-loading"><span className="loading-ring" aria-hidden="true"/><strong>Ajustando seu clima</strong><span>{activeNotice}</span></div></div>}
      </section>
    </main>
    {!desktop && <footer className="preview-footer"><span>UM PEQUENO CONTROLE. UM GRANDE CONFORTO.</span><span>Windows primeiro. macOS a caminho.</span></footer>}
  </div>;
}

function Setting({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: () => void }) {
  return <div className="setting-row"><div><strong>{label}</strong><span>{detail}</span></div><button className={`switch ${checked ? 'checked' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span/></button></div>;
}
