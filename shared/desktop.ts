export interface Integration {
  id: 'lg' | 'elgin';
  name: string;
  availability: 'available' | 'planned';
}

export interface DesktopBridge {
  readonly isDesktop: true;
  listIntegrations(): Promise<Integration[]>;
  energySettings: { read(): Promise<import('./energy').TariffSettings>; save(tariff: number | null): Promise<import('./energy').TariffSettings> };
  lg: {
    snapshot(): Promise<LGSnapshot>;
    energy(id: string): Promise<import('./energy').EnergyReport>;
    connect(token: string): Promise<LGSnapshot>;
    disconnect(): Promise<LGSnapshot>;
    select(id: string): Promise<LGSnapshot>;
    refresh(): Promise<LGSnapshot>;
    command(id: string, command: LGCommand): Promise<LGSnapshot>;
    openTokenPage(): Promise<void>;
    subscribe(listener: (snapshot: LGSnapshot) => void): () => void;
  };
}
import type { LGCommand, LGSnapshot } from './lg';
