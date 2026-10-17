import { useState } from 'react';
import { Fan, Minus, Plus, Power, Snowflake } from 'lucide-react';
import type { LGCommand, LGSnapshot } from '../shared/lg';

const labels: Record<string, string> = { COOL: 'Resfriar', AIR_DRY: 'Secar', FAN: 'Ventilar', AUTO: 'Auto', HEAT: 'Aquecer', LOW: 'Baixa', MID: 'Média', HIGH: 'Alta', POWER: 'Turbo' };
export default function LiveLGPanel({ snapshot: s, configure }: { snapshot: LGSnapshot; configure: () => void }) {
  const [failure, setFailure] = useState('');
  const lg = window.glacialpoint!.lg;
  const run = (action: () => Promise<unknown>) => { setFailure(''); void action().catch(() => setFailure('Não foi possível acessar a conexão. Tente novamente.')); };
  const command = (value: LGCommand) => run(() => lg.command(s.selectedId!, value));
  const state = s.state, caps = s.capabilities;
  const blocked = s.busy || !!s.error;
  const device = s.devices.find(d => d.id === s.selectedId);
  return <div className="live-lg">
    {!s.connected ? <div className="lg-welcome"><Snowflake size={36}/><h2>Seu LG, por perto.</h2><p>Conecte sua conta ThinQ para controlar os aparelhos cadastrados nela.</p><button className="lg-button primary" onClick={configure}>{s.busy ? 'Conexão em andamento…' : 'Configurar LG ThinQ'}</button></div> : <>
      <div className="device-tabs" role="group" aria-label="Aparelhos conectados">{s.devices.map(d => <button key={d.id} disabled={s.busy} aria-pressed={d.id === s.selectedId} onClick={() => run(() => lg.select(d.id))}>{d.name}</button>)}</div>
      <div className={`controls ${state?.power ? 'powered' : ''}`}>
        <div className="device-heading"><div><span className="section-label">LG ThinQ · {device?.model}</span><h2>{device?.name}</h2></div>{caps?.power && <button className={`power-button ${state?.power ? 'on' : ''}`} disabled={blocked || state?.power == null} aria-label={state?.power ? 'Desligar aparelho' : 'Ligar aparelho'} aria-pressed={state?.power ?? false} onClick={() => command({ field: 'power', value: !state?.power })}><Power size={22}/></button>}</div>
        {state && caps ? <>
          <div className="temperature"><span className="temperature-label">TEMPERATURA DESEJADA</span><div className="temperature-number"><span>{state.target ?? '—'}</span><span className="degree">°</span></div><span className="activity">{state.power ? labels[state.mode ?? ''] ?? state.mode ?? 'Ligado' : 'Aparelho desligado'}</span></div>
          <div className={`air-unit ${state.power ? 'running' : ''}`} aria-hidden="true"><div className="unit-body"><span className="unit-brand">GLACIALPOINT</span><span className="unit-led"/><div className="unit-slot"/></div><div className="air-lines"><i/><i/><i/><i/><i/></div></div>
          {caps.temperature && <div className="temperature-control"><button className="step-button" aria-label="Diminuir temperatura" disabled={blocked || !state.power || !['COOL','AUTO','HEAT'].includes(state.mode ?? '') || state.target === null || state.target <= caps.temperature.min} onClick={() => command({ field: 'target', value: Number((state.target! - caps.temperature!.step).toFixed(2)) })}><Minus size={17}/></button><span className="muted">{caps.temperature.min}° a {caps.temperature.max}° · Celsius</span><button className="step-button" aria-label="Aumentar temperatura" disabled={blocked || !state.power || !['COOL','AUTO','HEAT'].includes(state.mode ?? '') || state.target === null || state.target >= caps.temperature.max} onClick={() => command({ field: 'target', value: Number((state.target! + caps.temperature!.step).toFixed(2)) })}><Plus size={17}/></button></div>}
          {!!caps.modes.length && <fieldset disabled={blocked || !state.power} className="mode-fieldset"><legend className="section-label">MODO</legend><div className="mode-grid">{caps.modes.map(mode => <button key={mode} aria-pressed={state.mode === mode} className={state.mode === mode ? 'active' : ''} onClick={() => command({ field: 'mode', value: mode })}>{labels[mode] ?? mode}</button>)}</div></fieldset>}
          <fieldset disabled={blocked || !state.power} className="extras-fieldset"><legend className="sr-only">Controles adicionais</legend>
            {!!caps.fanSpeeds.length && <div className="fan-row"><div className="flex items-center gap-2"><Fan size={17}/>Ventilação</div><div className="fan-segments" role="radiogroup" aria-label="Velocidade da ventilação">{caps.fanSpeeds.map(value => <label key={value}><input type="radio" name="live-fan" checked={state.fan === value} onChange={() => command({ field: 'fan', value })}/><span>{labels[value] ?? value}</span></label>)}</div></div>}
            <div className="extras-grid">{caps.swing && <button disabled={state.swing === null} aria-pressed={state.swing ?? false} onClick={() => command({ field: 'swing', value: !state.swing })}>Oscilar {state.swing ? '✓' : ''}</button>}{caps.eco && <button disabled={state.eco === null} aria-pressed={state.eco ?? false} onClick={() => command({ field: 'eco', value: !state.eco })}>Eco {state.eco ? '✓' : ''}</button>}{caps.sleep && <label className="sleep-control"><span>Dormir</span><select aria-label="Temporizador de desligamento" value={state.sleepHours ?? ''} onChange={e => command({ field: 'sleepHours', value: Number(e.target.value) })}><option value="" disabled>Não informado</option><option value="0">Desativado</option>{[1,2,3,4,5,6,7].map(h => <option key={h} value={h}>{h} h</option>)}</select></label>}</div>
          </fieldset>
          <div className="ambient"><span>Ambiente <strong>{state.current ?? '—'}°</strong></span><span>{s.error ? 'Leitura anterior' : 'Dados da LG'}</span></div>
        </> : <p className="settings-footnote">{s.busy ? 'Consultando aparelho…' : 'Atualize para consultar o estado do aparelho.'}</p>}
        <div className="lg-refresh"><span>{s.updatedAt ? `Última leitura ${new Date(s.updatedAt).toLocaleTimeString('pt-BR')}` : 'Sem leitura'}{s.busy ? ' · Atualizando…' : ''}</span><button className="lg-button" disabled={s.busy} onClick={() => run(() => lg.refresh())}>Atualizar</button></div>
      </div>
    </>}
    {s.notice && !s.busy && <p className="lg-notice" role="status">{s.notice}</p>}
    {(failure || s.error) && <p className="lg-error" role="alert">{failure || s.error}</p>}
  </div>;
}
