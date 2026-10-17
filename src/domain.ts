// UI contract. Provider payloads and credentials belong in the Electron main process.
export type ProviderId = 'lg' | 'elgin';
export type Mode = 'cool' | 'dry' | 'fan' | 'auto';
export type FanSpeed = 'auto' | 'low' | 'medium' | 'high';
export interface DeviceState {
  power: boolean;
  target: number;
  mode: Mode;
  fan: FanSpeed;
  swing: boolean;
  eco: boolean;
  sleepHours: number;
}
export interface Device {
  id: string;
  provider: ProviderId;
  name: string;
  model: string;
  room: string;
  capabilities: { min: number; max: number; step: number };
}
export const demoDevice: Device = {
  id: 'demo-lg', provider: 'lg', name: 'LG Dual Inverter', model: 'LG ThinQ',
  room: 'Meu ambiente', capabilities: { min: 18, max: 30, step: 1 },
};
export const initialDemoState: DeviceState = {
  power: true, target: 23, mode: 'cool', fan: 'auto', swing: true, eco: false, sleepHours: 0,
};
