// Estimativa de consumo do Elgin: o aparelho não tem medidor de energia, então
// o consumo é reconstruído a partir do histórico de liga/desliga (logs de DP da
// Tuya, janela gratuita de 7 dias) multiplicado por um consumo médio
// configurável. O acumulado diário vive no armazenamento local para sobreviver
// à janela dos logs.
import { defaultAveragePower, energyPeriods, type EnergyPoint, type EnergyReport } from '../../shared/energy';
import type { ElginLogEntry } from './elgin-client';

export interface ElginUsageStore { read(): Record<string, number>; write(days: Record<string, number>): void }

export interface ElginSwitchEvent { time: number; on: boolean }

const timeZone = 'America/Sao_Paulo';
const dayMs = 86_400_000;
const stamps = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const offsets = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** Rótulo local (YYYYMMDD) de um instante, na mesma convenção de energyPeriods. */
export const dayOf = (time: number) => stamps.format(new Date(time)).replaceAll('-', '');

// O deslocamento é calculado a partir do fuso (em vez de fixar -03:00) para o
// dia local continuar correto caso o horário de verão volte.
export function dayStart(time: number): number {
  const parts = offsets.formatToParts(new Date(time));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const offset = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - Math.floor(time / 1000) * 1000;
  return Math.floor((time + offset) / dayMs) * dayMs - offset;
}

/** Início da janela de trabalho: meia-noite local de seis dias atrás (7 dias com hoje). */
export const usageWindowStart = (now: number) => dayStart(now) - 6 * dayMs;

/** Eventos de liga/desliga dos logs; valores estranhos são ignorados, não adivinhados. */
export function switchEvents(entries: ElginLogEntry[]): ElginSwitchEvent[] {
  const events: ElginSwitchEvent[] = [];
  for (const entry of entries) {
    if (entry.code !== 'switch') continue;
    const on = entry.value === true || entry.value === 'true' || entry.value === 1 || entry.value === '1';
    const off = entry.value === false || entry.value === 'false' || entry.value === 0 || entry.value === '0';
    if (on || off) events.push({ time: entry.time, on });
  }
  return events.sort((a, b) => a.time - b.time);
}

// Todo dia coberto pela janela entra no mapa (0 s quando nada foi registrado):
// ausência de dados é diferente de ausência de uso. Um período aberto só é
// fechado em "agora" quando o estado atual confirma que está ligado.
export function usageByDay(events: ElginSwitchEvent[], options: { from: number; to: number; currentPower: boolean | null }): Map<string, number> {
  const { from, to, currentPower } = options;
  const seconds = new Map<string, number>();
  for (let cursor = dayStart(from); cursor < to; cursor += dayMs) seconds.set(dayOf(cursor), 0);
  let open: number | null = null;
  const intervals: Array<[number, number]> = [];
  for (const event of events) {
    if (event.on) { if (open === null) open = event.time; }
    else if (open !== null) { if (event.time > open) intervals.push([open, event.time]); open = null; }
  }
  if (open !== null && currentPower === true && to > open) intervals.push([open, to]);
  for (const [start, end] of intervals) {
    let cursor = Math.max(start, from);
    const stop = Math.min(end, to);
    while (cursor < stop) {
      const slice = Math.min(stop, dayStart(cursor) + dayMs);
      const day = dayOf(cursor);
      seconds.set(day, (seconds.get(day) ?? 0) + (slice - cursor) / 1000);
      cursor = slice;
    }
  }
  return seconds;
}

/** A janela de logs é autoritativa para os dias cobertos; os demais ficam congelados. */
export function mergeUsage(stored: Record<string, number>, fresh: Map<string, number>): Record<string, number> {
  const merged: Record<string, number> = { ...stored };
  for (const [day, seconds] of fresh) merged[day] = Math.round(seconds);
  return merged;
}

export function buildEstimate(deviceId: string, days: Record<string, number>, averagePower: number, now: number): EnergyReport {
  const { daily: dates, monthly: months } = energyPeriods(new Date(now));
  const power = Number.isFinite(averagePower) && averagePower > 0 ? averagePower : defaultAveragePower;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const kwh = (seconds: number) => round(seconds / 3600 * power);
  const daily: EnergyPoint[] = dates.map(date => ({ date, kwh: days[date] === undefined ? null : kwh(days[date]) }));
  const monthly: EnergyPoint[] = months.map(month => {
    const covered = Object.entries(days).filter(([date]) => date.startsWith(month));
    return { date: month, kwh: covered.length ? round(covered.reduce((total, [, value]) => total + value / 3600 * power, 0)) : null };
  });
  return { deviceId, daily, monthly, updatedAt: now, error: null, supported: true, source: 'estimate' };
}
