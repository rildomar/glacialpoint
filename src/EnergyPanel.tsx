import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { EnergyPoint, EnergyReport } from '../shared/energy';
export const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const kwh = (value: number | null) => value === null ? 'Sem leitura' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kWh`;
function dateLabel(date: string) {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6) || 1))).toLocaleDateString('pt-BR', { ...(date.length === 8 ? { day: 'numeric' as const } : {}), month: 'short', timeZone: 'UTC' });
}
function Chart({ points, monthly = false }: { points: EnergyPoint[]; monthly?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const point = points.find(p => p.date === selected) ?? points.at(-1);
  const max = Math.max(1, ...points.map(p => p.kwh ?? 0));
  const top = Math.ceil(max / 3) * 3;
  return <>
    <div className="energy-plot"><div className="energy-axis" aria-hidden="true">{[top, top * 2 / 3, top / 3, 0].map(n => <span key={n}>{n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>)}</div><div className="energy-bars" role="group" aria-label={monthly ? 'Consumo mensal em kWh' : 'Consumo diário em kWh'} style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`, gap: points.length > 7 ? 3 : 8 }}>{points.map((p, i) => <button key={p.date} className={`${p.kwh === null ? 'missing' : ''} ${monthly && i === points.length - 1 ? 'partial' : ''}`} aria-pressed={point?.date === p.date} aria-label={`${dateLabel(p.date)}: ${kwh(p.kwh)}${monthly && i === points.length - 1 ? ', parcial' : ''}`} title={`${dateLabel(p.date)}: ${kwh(p.kwh)}`} onClick={() => setSelected(p.date)}><span style={{ height: p.kwh === null ? 4 : p.kwh === 0 ? 1 : `${p.kwh / top * 100}%` }}/></button>)}</div></div>
    <div className="energy-x" aria-hidden="true">{points.filter((_, i) => monthly || i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)).map(p => <span key={p.date}>{dateLabel(p.date)}</span>)}</div>
    <div className="energy-detail" aria-live="polite"><span>{point && dateLabel(point.date)}{monthly && point?.date === points.at(-1)?.date ? ' · parcial' : ''}</span><strong>{point && kwh(point.kwh)}</strong></div>
  </>;
}
export default function EnergyPanel({ deviceId, deviceName, back, tariffSettings }: { deviceId: string | null; deviceName?: string; back: () => void; tariffSettings: () => void }) {
  const [report, setReport] = useState<EnergyReport | null>(null);
  const [tariff, setTariff] = useState<number | null>(null);
  const [failure, setFailure] = useState('');
  const [tariffError, setTariffError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState(7);
  useEffect(() => {
    let active = true; setReport(null); setLoading(true); setFailure('');
    if (!deviceId) { setLoading(false); return; }
    void window.glacialpoint!.lg.energy(deviceId).then(value => { if (active) setReport(value); }).catch(() => { if (active) setFailure('Não foi possível consultar o consumo.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [deviceId, attempt]);
  useEffect(() => { let active = true; void window.glacialpoint!.energySettings.read().then(value => { if (active) setTariff(value.tariff); }).catch(() => { if (active) setTariffError(true); }); return () => { active = false; }; }, []);
  const current = report?.monthly.at(-1), previous = report?.monthly.at(-2), yesterday = report?.daily.at(-1);
  return <div className="energy-content"><button className="back-link" onClick={back}><ArrowLeft size={15}/>Voltar aos controles</button><span className="energy-device">{deviceName ?? 'LG ThinQ'}</span><h2>Seu consumo.</h2><p className="energy-subtitle">Mais clareza sobre o seu conforto.</p>
    {!deviceId ? <p>Conecte e selecione um aparelho nos controles.</p> : loading ? <div className="energy-loading" role="status"><span className="loading-ring"/>Consultando consumo na LG…</div> : failure || report?.error ? <div role="alert"><p>{failure || report?.error}</p><button className="lg-button" onClick={() => setAttempt(a => a + 1)}>Tentar novamente</button></div> : report && !report.supported ? <p>A LG não disponibiliza histórico de energia para este aparelho.</p> : report && <>
      <section className="energy-hero" aria-label="Consumo do mês"><div className="energy-detail"><span>{current && dateLabel(current.date)} · {current?.date.slice(0, 4)}</span><span className="small-badge">PARCIAL</span></div><div className="energy-value">{current?.kwh == null ? 'Sem leitura' : <>{current.kwh.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}<small> kWh</small></>}</div><span className="energy-caption">Acumulado informado pela LG</span><div className="energy-estimate"><span>Custo estimado do ar-condicionado</span><strong>{tariff !== null && current?.kwh != null ? `≈ ${money(tariff * current.kwh)}` : '—'}</strong><button onClick={tariffSettings}>{tariffError ? 'Não foi possível ler a tarifa · configurar' : tariff === null ? 'Informar minha tarifa' : `Tarifa: ${tariff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 })}/kWh · editar`}</button></div></section>
      <div className="energy-stats"><div><span>Ontem · {yesterday && dateLabel(yesterday.date)}</span><strong>{kwh(yesterday?.kwh ?? null)}</strong></div><div><span>Mês anterior · fechado</span><strong>{kwh(previous?.kwh ?? null)}</strong></div></div>
      <div className="energy-chart-head"><h3>Dia a dia <small>kWh</small></h3><div className="energy-segments" role="group" aria-label="Período diário">{[7, 30].map(n => <button key={n} aria-pressed={period === n} onClick={() => setPeriod(n)}>{n} dias</button>)}</div></div><Chart points={report.daily.slice(-period)}/>
      <div className="energy-months"><div className="energy-chart-head"><h3>Mês a mês <small>kWh</small></h3><span>6 meses</span></div><Chart points={report.monthly} monthly/></div>
      <p className="energy-caption">Traço cinza: sem leitura. Barra listrada: mês parcial. A LG pode atualizar valores com atraso.</p><p className="energy-caption">Estimativa com a tarifa atual aplicada ao consumo do mês, sem cobranças fixas.</p>
      <div className="energy-detail"><span>Consulta: {new Date(report.updatedAt).toLocaleString('pt-BR')}</span><button className="lg-button" onClick={() => setAttempt(a => a + 1)}>Atualizar</button></div><p className="energy-caption">Consultas reutilizadas por até 5 minutos.</p>
    </>}
  </div>;
}
