import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { validAveragePower, validTariff, type TariffSettings } from '../shared/energy';
export function tariffStore(directory: string) {
  const file = path.join(directory, 'energy-settings.json');
  const validate = (tariff: unknown, averagePower: unknown): TariffSettings => {
    if (!validTariff(tariff) || !validAveragePower(averagePower)) throw new Error('Invalid energy settings');
    return { tariff, averagePower };
  };
  return {
    read(): TariffSettings {
      if (!existsSync(file)) return { tariff: null, averagePower: null };
      const value = JSON.parse(readFileSync(file, 'utf8')) as { tariff?: unknown; averagePower?: unknown } | null;
      if (value === null || typeof value !== 'object') throw new Error('Invalid energy settings');
      // Arquivos antigos guardavam só a tarifa; ausência vira null e o padrão vale.
      return validate(value.tariff ?? null, value.averagePower ?? null);
    },
    write(input: unknown): TariffSettings {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid energy settings');
      const value = input as { tariff?: unknown; averagePower?: unknown };
      const settings = validate(value.tariff ?? null, value.averagePower ?? null);
      mkdirSync(directory, { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify(settings), 'utf8');
      renameSync(file + '.tmp', file);
      return settings;
    },
  };
}
