import { useState } from 'react';
import { Check, Droplets, Flame, Leaf, Lock, Minus, Moon, Plus, Power, Snowflake, Sparkles, Sun, Waves, Wind, type LucideIcon } from 'lucide-react';
import type { ElginCommand, ElginRealtime, ElginSnapshot } from '../shared/elgin';

const modeLabels: Record<string, string> = { cold: 'Resfriar', hot: 'Aquecer', wet: 'Secar', wind: 'Ventilar', auto: 'Auto' };
const modeIcons: Record<string, LucideIcon> = { cold: Snowflake, hot: Flame, wet: Droplets, wind: Wind, auto: Sparkles };
// Modos em que o setpoint faz sentido (o mesmo recorte que o app da Tuya usa).
const temperatureModes = ['cold', 'hot', 'auto'];
const realtimeLabels: Record<ElginRealtime, string> = { connecting: 'conectando tempo real…', on: 'tempo real ativo', blocked: 'tempo real indisponível' };

export default function LiveElginPanel({ snapshot: s, configure, guide }: { snapshot: ElginSnapshot; configure: () => void; guide: () => void }) {
  const [failure, setFailure] = useState('');
  const elgin = window.glacialpoint!.elgin;
  const run = (action: () => Promise<unknown>) => { setFailure(''); void action().catch(() => setFailure('Não foi possível acessar a conexão. Tente novamente.')); };
  const command = (value: ElginCommand) => run(() => elgin.command(s.selectedId!, value));
  const state = s.state, caps = s.capabilities;
  const blocked = s.busy || !!s.error;
  const device = s.devices.find(d => d.id === s.selectedId);
  // O perfil anuncia 16–90 ℃ porque o mesmo DP atende ao modo Fahrenheit. Num
  // split em Celsius a faixa útil termina em 30 ℃; confirmar com o aparelho.
  const temperatureMax = caps?.temperature ? Math.min(caps.temperature.max, 30) : null;
  const canAdjustTemperature = !!state?.power && temperatureModes.includes(state?.mode ?? '');
  return <div className="live-lg live-elgin">
    {!s.connected ? <div className="lg-welcome"><Snowflake size={36}/><h2>Seu Elgin, no ponto.</h2><p>Conecte seu projeto Tuya Cloud para controlar o ar-condicionado de qualquer lugar.</p><div className="welcome-actions"><button className="lg-button primary" onClick={configure}>{s.busy ? 'Conexão em andamento…' : 'Configurar Elgin Smart'}</button><button className="lg-button" onClick={guide}>Como conectar</button></div></div> : <>
      {/* Com um único aparelho o nome já aparece no cabeçalho; o seletor só é exibido quando há mais de um. */}
      {s.devices.length > 1 && <div className="device-tabs" role="group" aria-label="Aparelhos conectados">{s.devices.map(d => <button key={d.id} disabled={s.busy} aria-pressed={d.id === s.selectedId} onClick={() => run(() => elgin.select(d.id))}>{d.name}</button>)}</div>}
      <div className={`controls ${state?.power ? 'powered' : ''}`}>
        <div className="device-heading"><div><span className="section-label">Elgin Smart · {device?.model}</span><h2>{device?.name}</h2></div>{caps?.power && <button className={`power-button ${state?.power ? 'on' : ''}`} disabled={blocked || state?.power == null} aria-label={state?.power ? 'Desligar aparelho' : 'Ligar aparelho'} aria-pressed={state?.power ?? false} onClick={() => command({ field: 'power', value: !state?.power })}><Power size={22}/></button>}</div>
        {state && caps ? <>
          <div className="temperature"><span className="temperature-label">TEMPERATURA DESEJADA</span><div className="temperature-number"><span>{state.target ?? '—'}</span><span className="degree">°</span></div><span className="activity">{state.power ? modeLabels[state.mode ?? ''] ?? state.mode ?? 'Ligado' : 'Aparelho desligado'}</span></div>
          <div className={`air-unit ${state.power ? 'running' : ''}`} aria-hidden="true"><div className="unit-body"><span className="unit-brand">GLACIALPOINT</span><span className="unit-led"/><div className="unit-slot"/></div><div className="air-lines"><i/><i/><i/><i/><i/></div></div>
          {caps.temperature && temperatureMax !== null && <div className="temperature-control"><button className="step-button" aria-label="Diminuir temperatura" disabled={blocked || !canAdjustTemperature || state.target === null || state.target <= caps.temperature.min} onClick={() => command({ field: 'target', value: Number((state.target! - caps.temperature!.step).toFixed(2)) })}><Minus size={17}/></button><span className="muted">{caps.temperature.min}° a {temperatureMax}° · Celsius</span><button className="step-button" aria-label="Aumentar temperatura" disabled={blocked || !canAdjustTemperature || state.target === null || state.target >= temperatureMax} onClick={() => command({ field: 'target', value: Number((state.target! + caps.temperature!.step).toFixed(2)) })}><Plus size={17}/></button></div>}
          {!!caps.modes.length && <fieldset disabled={blocked || !state.power} className="mode-fieldset"><legend className="section-label">MODO</legend><div className="mode-grid">{caps.modes.map(mode => { const Icon = modeIcons[mode] ?? Wind; return <button key={mode} aria-pressed={state.mode === mode} className={state.mode === mode ? 'active' : ''} onClick={() => command({ field: 'mode', value: mode })}><Icon size={18}/><span>{modeLabels[mode] ?? mode}</span></button>; })}</div></fieldset>}
          <fieldset disabled={blocked || !state.power} className="extras-fieldset"><legend className="sr-only">Controles adicionais</legend>
            <div className="extras-grid">
              {caps.swingHorizontal && <button aria-pressed={state.swingHorizontal ?? false} disabled={state.swingHorizontal === null} onClick={() => command({ field: 'swingHorizontal', value: !state.swingHorizontal })}><Waves size={19}/><span>Oscilar</span><span className={`mini-indicator ${state.swingHorizontal ? 'active' : ''}`}>{state.swingHorizontal ? <Check size={10}/> : null}</span></button>}
              {caps.eco && <button aria-pressed={state.eco ?? false} disabled={state.eco === null} onClick={() => command({ field: 'eco', value: !state.eco })}><Leaf size={19}/><span>Eco</span><span className={`mini-indicator ${state.eco ? 'active' : ''}`}>{state.eco ? <Check size={10}/> : null}</span></button>}
              {caps.sleep && <button aria-pressed={state.sleep ?? false} disabled={state.sleep === null} onClick={() => command({ field: 'sleep', value: !state.sleep })}><Moon size={19}/><span>Dormir</span><span className={`mini-indicator ${state.sleep ? 'active' : ''}`}>{state.sleep ? <Check size={10}/> : null}</span></button>}
              {caps.light && <button aria-pressed={state.light ?? false} disabled={state.light === null} onClick={() => command({ field: 'light', value: !state.light })}><Sun size={19}/><span>Luz</span><span className={`mini-indicator ${state.light ? 'active' : ''}`}>{state.light ? <Check size={10}/> : null}</span></button>}
              {caps.lock && <button aria-pressed={state.lock ?? false} disabled={state.lock === null} onClick={() => command({ field: 'lock', value: !state.lock })}><Lock size={19}/><span>Trava</span><span className={`mini-indicator ${state.lock ? 'active' : ''}`}>{state.lock ? <Check size={10}/> : null}</span></button>}
            </div>
          </fieldset>
          <div className="ambient"><span>Ambiente <strong>{state.current ?? '—'}°</strong></span><span>{s.error ? 'Leitura anterior' : 'Dados da Elgin'}</span></div>
        </> : <p className="settings-footnote">{s.busy ? 'Consultando aparelho…' : 'Atualize para consultar o estado do aparelho.'}</p>}
        <div className="lg-refresh"><span title={s.realtime === 'blocked' ? 'O serviço de mensagens da Tuya não está habilitado para este projeto; o painel atualiza por consulta periódica.' : undefined}>{s.updatedAt ? `Última leitura ${new Date(s.updatedAt).toLocaleTimeString('pt-BR')}` : 'Sem leitura'}{s.busy ? ' · Atualizando…' : ''}{s.realtime ? ` · ${realtimeLabels[s.realtime]}` : ''}</span><button className="lg-button" disabled={s.busy} onClick={() => run(() => elgin.refresh())}>Atualizar</button></div>
      </div>
    </>}
    {s.notice && !s.busy && <p className="lg-notice" role="status">{s.notice}</p>}
    {(failure || s.error) && <p className="lg-error" role="alert">{failure || s.error}</p>}
  </div>;
}
