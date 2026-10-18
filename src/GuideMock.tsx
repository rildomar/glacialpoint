import type { ReactNode } from 'react';

// Ilustrações decorativas dos tutoriais: mini "telas" desenhadas em CSS/SVG,
// com animações sutis que o modo "Reduzir movimento" já desliga globalmente.
// Nada aqui é um QR ou uma tela real — é um esboço do que a pessoa vai ver.

const QR_MODULES = (() => {
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    const inEye = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    if (inEye || (x * 7 + y * 13) % 5 >= 2) continue;
    cells.push([x, y]);
  }
  return cells;
})();

function QrCode() {
  const eye = (x: number, y: number) => <g key={`e${x}-${y}`}><rect x={x} y={y} width="7" height="7" rx="1"/><rect className="mock-qr-in" x={x + 1} y={y + 1} width="5" height="5"/><rect x={x + 2} y={y + 2} width="3" height="3"/></g>;
  return <svg className="mock-qr" viewBox="-1 -1 23 23" aria-hidden="true">
    <g>{QR_MODULES.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1"/>)}</g>
    {eye(0, 0)}{eye(14, 0)}{eye(0, 14)}
  </svg>;
}

function MockWindow({ url, children }: { url: string; children: ReactNode }) {
  return <div className="mock-window" aria-hidden="true">
    <div className="mock-bar"><i/><i/><i/><span>{url}</span></div>
    <div className="mock-body">{children}</div>
  </div>;
}

export function MockPortalLogin() {
  return <MockWindow url="connect-pat.lgthinq.com">
    <span className="mock-line w50"/>
    <span className="mock-field">voce@email.com</span>
    <span className="mock-field">••••••••</span>
    <span className="mock-cta">Entrar com QR</span>
  </MockWindow>;
}

export function MockTokenCreate() {
  return <MockWindow url="connect-pat.lgthinq.com">
    <span className="mock-line w60"/>
    <span className="mock-cta">CREATE</span>
    <span className="mock-token">thinqpat_••••••••<i className="mock-copy"/></span>
  </MockWindow>;
}

export function MockConsoleServices() {
  return <MockWindow url="iot.tuya.com">
    <div className="mock-console">
      <div className="mock-side"><i/><i/><i/><i/></div>
      <div className="mock-main">
        <span className="mock-line w50"/>
        <div className="mock-service"><span>Smart Home Basic Service</span><i className="mock-switch d1"/></div>
        <div className="mock-service"><span>Device Status Notification</span><i className="mock-switch d2"/></div>
      </div>
    </div>
  </MockWindow>;
}

export function MockScan({ caption, confirmation }: { caption: string; confirmation: string }) {
  return <div className="mock-scan" aria-hidden="true">
    <div className="mock-phone">
      <span className="mock-phone-notch"/>
      <div className="mock-camera"><QrCode/><span className="mock-beam"/><span className="mock-camera-hint">{caption}</span></div>
    </div>
    <span className="mock-confirm">✓ {confirmation}</span>
  </div>;
}
