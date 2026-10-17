import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { validTariff, type TariffSettings } from '../shared/energy';
export function tariffStore(directory: string) {
  const file = path.join(directory, 'energy-settings.json');
  return {
    read(): TariffSettings {
      if (!existsSync(file)) return { tariff: null };
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (!validTariff(value.tariff)) throw new Error('Invalid tariff settings');
      return { tariff: value.tariff };
    },
    write(tariff: unknown): TariffSettings {
      if (!validTariff(tariff)) throw new Error('Invalid tariff');
      mkdirSync(directory, { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify({ tariff }), 'utf8');
      renameSync(file + '.tmp', file);
      return { tariff };
    },
  };
}
