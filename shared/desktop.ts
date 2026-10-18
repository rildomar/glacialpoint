export interface Integration {
  id: 'lg' | 'elgin';
  name: string;
  availability: 'available' | 'planned';
}

export interface DesktopBridge {
  readonly isDesktop: true;
  listIntegrations(): Promise<Integration[]>;
  energySettings: { read(): Promise<import('./energy').TariffSettings>; save(settings: import('./energy').TariffSettings): Promise<import('./energy').TariffSettings> };
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
  elgin: {
    snapshot(): Promise<ElginSnapshot>;
    energy(id: string): Promise<import('./energy').EnergyReport>;
    connect(project: ElginProject): Promise<ElginSnapshot>;
    disconnect(): Promise<ElginSnapshot>;
    select(id: string): Promise<ElginSnapshot>;
    refresh(): Promise<ElginSnapshot>;
    command(id: string, command: ElginCommand): Promise<ElginSnapshot>;
    openConsolePage(): Promise<void>;
    subscribe(listener: (snapshot: ElginSnapshot) => void): () => void;
  };
}
import type { ElginCommand, ElginProject, ElginSnapshot } from './elgin';
import type { LGCommand, LGSnapshot } from './lg';
