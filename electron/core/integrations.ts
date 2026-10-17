import type { Integration } from '../../shared/desktop';

// Provider-specific transports and credentials will remain outside the renderer.
export function listIntegrations(): Integration[] {
  return [
    { id: 'lg', name: 'LG ThinQ', availability: 'available' },
    { id: 'elgin', name: 'Elgin Smart', availability: 'available' },
  ];
}
