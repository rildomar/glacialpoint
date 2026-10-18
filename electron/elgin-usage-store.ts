import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElginUsageStore } from './core/elgin-energy';

// Acumulado diário da estimativa de consumo (YYYYMMDD → segundos ligado).
// A leitura é tolerante: o arquivo é reconstruível a partir dos logs, então um
// valor estranho é descartado em vez de derrubar a tela de consumo.
export function usageStore(directory: string): ElginUsageStore {
  const file = path.join(directory, 'energy-estimate.json');
  return {
    read() {
      if (!existsSync(file)) return {};
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as { days?: unknown };
        const days: Record<string, number> = {};
        if (value.days !== null && typeof value.days === 'object' && !Array.isArray(value.days)) {
          for (const [day, seconds] of Object.entries(value.days)) {
            if (/^\d{8}$/.test(day) && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) days[day] = seconds;
          }
        }
        return days;
      } catch { return {}; }
    },
    write(days) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify({ version: 1, days }), 'utf8');
      renameSync(file + '.tmp', file);
    },
  };
}
