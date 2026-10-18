// Contratos do adaptador Elgin (plataforma Tuya Cloud). A autenticação é por
// projeto (Access ID/Secret + região do datacenter) e as capacidades vêm do
// perfil anunciado pelo próprio aparelho — nada é presumido.
export const elginRegions = ['us', 'ue', 'eu', 'we', 'cn', 'in', 'sg'] as const;
export type ElginRegion = (typeof elginRegions)[number];

export interface ElginDevice { id: string; name: string; model: string }

export interface ElginCapabilities {
  power: boolean;
  modes: string[];
  // min/max/step em °C para a interface; scale é a escala do protocolo
  // (casas decimais) usada ao codificar comandos e decodificar leituras.
  temperature: { min: number; max: number; step: number; scale: number } | null;
  swingHorizontal: boolean;
  eco: boolean;
  sleep: boolean;
  light: boolean;
  lock: boolean;
}

export interface ElginState {
  power: boolean | null; mode: string | null; current: number | null; target: number | null;
  eco: boolean | null; sleep: boolean | null; light: boolean | null; lock: boolean | null;
  swingHorizontal: boolean | null;
}

export type ElginCommand =
  | { field: 'power' | 'swingHorizontal' | 'eco' | 'sleep' | 'light' | 'lock'; value: boolean }
  | { field: 'mode'; value: string }
  | { field: 'target'; value: number };

export interface ElginProject { accessId: string; accessSecret: string; region: ElginRegion }
export interface ElginCredentials extends ElginProject { selectedId: string | null }

// Escuta em tempo real (push da nuvem): null = desligada; blocked = o serviço
// de mensagens não está habilitado no projeto Tuya (volta ao polling).
export type ElginRealtime = 'connecting' | 'on' | 'blocked';

export interface ElginSnapshot {
  connected: boolean; busy: boolean; devices: ElginDevice[]; selectedId: string | null;
  state: ElginState | null; capabilities: ElginCapabilities | null;
  error: string | null; notice: string | null; updatedAt: number | null;
  realtime: ElginRealtime | null;
}

export const emptyElgin: ElginSnapshot = { connected: false, busy: false, devices: [], selectedId: null, state: null, capabilities: null, error: null, notice: null, updatedAt: null, realtime: null };
