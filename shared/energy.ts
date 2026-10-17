export interface EnergyPoint { date: string; kwh: number | null }
export interface EnergyReport { deviceId: string; daily: EnergyPoint[]; monthly: EnergyPoint[]; updatedAt: number; error: string | null; supported: boolean }
export interface TariffSettings { tariff: number | null }
export function energyPeriods(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
  const year = Number(today.slice(0, 4)), month = Number(today.slice(4, 6)), day = Number(today.slice(6));
  const stamp = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '');
  return { today, daily: Array.from({ length: 30 }, (_, i) => stamp(new Date(Date.UTC(year, month - 1, day - 30 + i)))), monthly: Array.from({ length: 6 }, (_, i) => stamp(new Date(Date.UTC(year, month - 6 + i, 1))).slice(0, 6)) };
}
export const validTariff = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000;
