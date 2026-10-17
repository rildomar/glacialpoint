import { useState } from 'react';
import type { LGSnapshot } from '../shared/lg';

export default function LGConnection({ snapshot }: { snapshot: LGSnapshot }) {
  const [token, setToken] = useState('');
  const [failure, setFailure] = useState('');
  const lg = window.glacialpoint?.lg;
  const run = (action: () => Promise<unknown>) => { setFailure(''); void action().catch(() => setFailure('Não foi possível acessar a conexão. Tente novamente.')); };
  return <section className="lg-connection" aria-label="Conexão LG ThinQ">
    <div className="integration-row"><span className="provider-logo">LG</span><div><strong>LG ThinQ</strong><span>{snapshot.connected ? `${snapshot.devices.length} aparelho(s) · Brasil` : 'Conecte sua conta · Brasil'}</span></div></div>
    {!lg ? <p className="settings-footnote">Abra a versão desktop para conectar sua conta. Esta página é uma demonstração.</p> : snapshot.connected ? <>
      <p className="settings-footnote">Token protegido pelo Windows. Sua conta será reconectada ao abrir o aplicativo.</p>
      <button className="lg-button" onClick={() => run(() => lg.disconnect())}>Desconectar conta</button>
    </> : <form onSubmit={event => { event.preventDefault(); const value = token; setToken(''); run(() => lg.connect(value)); }}>
      <p className="settings-footnote">Gere um token pessoal com a mesma conta usada no LG ThinQ. Autorize a consulta e o controle dos seus aparelhos.</p>
      <button type="button" className="lg-button" onClick={() => run(() => lg.openTokenPage())}>Abrir portal de tokens da LG ↗</button>
      <label className="lg-token-label" htmlFor="lg-token">Token pessoal</label>
      <input id="lg-token" className="lg-input" type="password" autoComplete="off" spellCheck={false} placeholder="thinqpat_…" value={token} disabled={snapshot.busy} onChange={event => setToken(event.target.value)}/>
      <p className="settings-footnote">Salvo de forma criptografada neste computador. Não compartilhe o token no chat.</p>
      <button className="lg-button primary" type="submit" disabled={!token.trim() || snapshot.busy}>{snapshot.busy ? 'Conectando…' : 'Conectar LG ThinQ'}</button>
      {snapshot.busy && <button className="lg-button" type="button" onClick={() => run(() => lg.disconnect())}>Cancelar conexão</button>}
    </form>}
    {(failure || snapshot.error) && <p className="lg-error" role="alert">{failure || snapshot.error}</p>}
  </section>;
}
