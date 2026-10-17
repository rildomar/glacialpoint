import { useEffect, useState, type FormEvent } from 'react';
import { elginRegions, type ElginRegion, type ElginSnapshot } from '../shared/elgin';

const regionLabels: Record<ElginRegion, string> = {
  us: 'Western America (US)',
  ue: 'Eastern America (UE)',
  eu: 'Europa Central',
  we: 'Europa Ocidental',
  cn: 'China',
  in: 'Índia',
  sg: 'Singapura',
};

export default function ElginConnection({ snapshot, onConnected }: { snapshot: ElginSnapshot; onConnected?: () => void }) {
  const [accessId, setAccessId] = useState('');
  const [accessSecret, setAccessSecret] = useState('');
  const [region, setRegion] = useState<ElginRegion>('us');
  const [failure, setFailure] = useState('');
  const elgin = window.glacialpoint?.elgin;
  const run = (action: () => Promise<unknown>) => { setFailure(''); void action().catch(() => setFailure('Não foi possível acessar a conexão. Tente novamente.')); };
  // Ao conectar, o formulário some; limpar também o estado evita que as credenciais
  // reapareçam caso o usuário desconecte a conta em seguida.
  useEffect(() => { if (snapshot.connected) { setAccessId(''); setAccessSecret(''); } }, [snapshot.connected]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const project = { accessId: accessId.trim(), accessSecret: accessSecret.trim(), region };
    setAccessSecret('');
    setFailure('');
    void elgin!.connect(project).then(value => { if (value.connected) onConnected?.(); }).catch(() => setFailure('Não foi possível acessar a conexão. Tente novamente.'));
  };
  return <section className="lg-connection" aria-label="Conexão Elgin Smart">
    <div className="integration-row"><span className="provider-logo elgin-logo">e</span><div><strong>Elgin Smart</strong><span>{snapshot.connected ? `${snapshot.devices.length} aparelho(s) · Tuya Cloud` : 'Conecte seu projeto Tuya Cloud'}</span></div></div>
    {!elgin ? <p className="settings-footnote">Abra a versão desktop para conectar sua conta. Esta página é uma demonstração.</p> : snapshot.connected ? <>
      <p className="settings-footnote">Credenciais protegidas pelo Windows. Sua conta Tuya será reconectada ao abrir o aplicativo.</p>
      <button className="lg-button" onClick={() => run(() => elgin.disconnect())}>Desconectar Elgin</button>
    </> : <form onSubmit={submit}>
      <p className="settings-footnote">Informe as credenciais do projeto Tuya Cloud vinculado ao aplicativo Smart Life. O controle passa pela nuvem — o ar-condicionado não precisa estar na mesma rede.</p>
      <label className="lg-token-label" htmlFor="elgin-access-id">Access ID</label>
      <input id="elgin-access-id" className="lg-input" autoComplete="off" spellCheck={false} placeholder="ID do projeto Tuya" value={accessId} disabled={snapshot.busy} onChange={event => setAccessId(event.target.value)}/>
      <label className="lg-token-label" htmlFor="elgin-access-secret">Access Secret</label>
      <input id="elgin-access-secret" className="lg-input" type="password" autoComplete="off" spellCheck={false} placeholder="Secret do projeto Tuya" value={accessSecret} disabled={snapshot.busy} onChange={event => setAccessSecret(event.target.value)}/>
      <label className="lg-token-label" htmlFor="elgin-region">Região do projeto</label>
      <select id="elgin-region" className="lg-input" value={region} disabled={snapshot.busy} onChange={event => setRegion(event.target.value as ElginRegion)}>{elginRegions.map(code => <option key={code} value={code}>{regionLabels[code]}</option>)}</select>
      <p className="settings-footnote">No Brasil, use Western America. As credenciais são criptografadas neste computador.</p>
      <button className="lg-button primary" type="submit" disabled={!accessId.trim() || !accessSecret.trim() || snapshot.busy}>{snapshot.busy ? 'Conectando…' : 'Conectar Elgin'}</button>
      {snapshot.busy && <button className="lg-button" type="button" onClick={() => run(() => elgin.disconnect())}>Cancelar conexão</button>}
    </form>}
    {(failure || snapshot.error) && <p className="lg-error" role="alert">{failure || snapshot.error}</p>}
  </section>;
}
