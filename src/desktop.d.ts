import type { DesktopBridge } from '../shared/desktop';

declare global {
  interface Window {
    glacialpoint?: DesktopBridge;
  }
}
