// Mostrador de temperatura: o arco desenha a escala do aparelho e também é o
// seletor — arrastar (ou usar as setas do teclado) escolhe a temperatura
// desejada, confirmada só ao soltar o clique. O centro mostra o valor
// selecionado; o ambiente é exibido fora deste componente, como legenda.
import { useRef, useState } from 'react';

const sweep = 220;
const radius = 76;

function polar(t: number, distance = radius) {
  const angle = (-sweep / 2 + t * sweep) * Math.PI / 180;
  return { x: 110 + distance * Math.sin(angle), y: 100 - distance * Math.cos(angle) };
}

function arcPath(from: number, to: number) {
  const start = polar(from), end = polar(to);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${(to - from) * sweep > 180 ? 1 : 0} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const tickLabel = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export default function TemperatureDial({ min, max, step, target, power, status, disabled, onSelect }: {
  min: number; max: number; step: number; target: number | null;
  power: boolean; status: string; disabled: boolean; onSelect: (value: number) => void;
}) {
  // Rascunho local durante o arrasto: o centro e a marca seguem o ponteiro e
  // o comando só sai quando o clique é solto (ou numa tecla de ajuste).
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const span = Math.max(max - min, 0.01);
  const round = (value: number) => Number((Math.round((value - min) / step) * step + min).toFixed(2));
  const clamp = (value: number) => Math.min(max, Math.max(min, round(value)));
  const desired = draft ?? target;
  const ratio = desired === null ? null : Math.min(1, Math.max(0, (desired - min) / span));
  const mark = ratio === null ? null : polar(ratio);
  // Ângulo do ponteiro convertido na escala do arco; fora da abertura, fica no fim mais próximo.
  const valueAt = (event: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width * (110 / 220));
    const dy = event.clientY - (box.top + box.height * (100 / 160));
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI);
    return clamp(min + Math.min(1, Math.max(0, (angle + sweep / 2) / sweep)) * (max - min));
  };
  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft(valueAt(event));
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => { if (dragging.current) setDraft(valueAt(event)); };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const value = valueAt(event);
    setDraft(null);
    if (value !== target) onSelect(value);
  };
  const cancel = () => { dragging.current = false; setDraft(null); };
  const keys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const base = draft ?? target ?? min;
    const next = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? base + step
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? base - step
      : event.key === 'Home' ? min : event.key === 'End' ? max : null;
    if (next === null) return;
    event.preventDefault();
    const value = clamp(next);
    if (value !== target) onSelect(value);
  };
  return <div className={`temperature-dial ${power ? 'running' : 'off'} ${disabled ? 'locked' : ''}`}>
    <svg ref={svg} viewBox="0 0 220 160" aria-hidden="true" focusable="false">
      <path className="dial-track" d={arcPath(0, 1)} />
      {ratio !== null && ratio > 0.004 && <path className="dial-progress" d={arcPath(0, ratio)} />}
      {[0, .25, .5, .75, 1].map(t => { const inner = polar(t, 82), outer = polar(t, 88); return <line key={t} className="dial-tick" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />; })}
      {[0, .5, 1].map(t => { const spot = polar(t, 96); return <text key={t} className="dial-tick-label" x={spot.x} y={spot.y + 3} textAnchor="middle">{tickLabel(min + t * (max - min))}</text>; })}
      {mark && <circle className="dial-mark" cx={mark.x} cy={mark.y} r={6.5} />}
    </svg>
    <div className="dial-center">
      <div className="dial-number"><span>{desired ?? '—'}</span><span className="degree">°</span></div>
    </div>
    <span className={`dial-status ${power ? 'on' : ''}`}>{status}</span>
    <div className="dial-hit" role="slider" tabIndex={disabled ? -1 : 0} aria-label="Temperatura desejada" aria-valuemin={min} aria-valuemax={max} aria-valuenow={desired ?? min} aria-valuetext={`${desired ?? min} graus`} aria-disabled={disabled}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onKeyDown={keys}/>
  </div>;
}
