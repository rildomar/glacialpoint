export interface LGDevice { id: string; name: string; model: string }
export interface LGCapabilities {
  power: boolean; modes: string[]; fanSpeeds: string[];
  temperature: { min: number; max: number; step: number } | null;
  swing: boolean; eco: boolean; sleep: boolean;
}
export interface LGState {
  power: boolean | null; mode: string | null; current: number | null; target: number | null;
  fan: string | null; swing: boolean | null; eco: boolean | null; sleepHours: number | null;
}
export type LGCommand =
  | { field: 'power' | 'swing' | 'eco'; value: boolean }
  | { field: 'mode' | 'fan'; value: string }
  | { field: 'target' | 'sleepHours'; value: number };
// Escuta em tempo real (push da nuvem): null = desligada; blocked = a LG não
// liberou o canal (token sem permissão de eventos ou modelo sem suporte),
// restando o polling como caminho de atualização.
export type LGRealtime = 'connecting' | 'on' | 'blocked';

export interface LGSnapshot {
  connected: boolean; busy: boolean; devices: LGDevice[]; selectedId: string | null;
  state: LGState | null; capabilities: LGCapabilities | null;
  error: string | null; notice: string | null; updatedAt: number | null;
  realtime: LGRealtime | null;
}
export const emptyLG: LGSnapshot = { connected: false, busy: false, devices: [], selectedId: null, state: null, capabilities: null, error: null, notice: null, updatedAt: null, realtime: null };
