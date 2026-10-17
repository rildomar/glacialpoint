import { setTimeout as delay } from 'node:timers/promises';
import { elginRegions, emptyElgin, type ElginCommand, type ElginCredentials, type ElginProject, type ElginRegion, type ElginSnapshot } from '../../shared/elgin';
import { commandPayload, ElginClient, ElginError, matchesCommand, publicError, type ElginTransport } from './elgin-client';

export interface ElginCredentialStore { read(): ElginCredentials | null; write(value: ElginCredentials): void; clear(): void }

export class ElginSession {
  private snapshot: ElginSnapshot = structuredClone(emptyElgin);
  private credentials: ElginCredentials | null = null;
  private client: ElginTransport | null = null;
  private controller = new AbortController();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private suspended = false;
  constructor(
    private readonly vault: ElginCredentialStore,
    private readonly emit: (snapshot: ElginSnapshot) => void,
    private readonly makeClient: (project: ElginProject) => ElginTransport = project => new ElginClient(project),
    private readonly settle: (signal: AbortSignal) => Promise<unknown> = signal => delay(3000, undefined, { signal }),
  ) {}
  get() { return structuredClone(this.snapshot); }
  private publish(patch: Partial<ElginSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.emit(this.get()); }
  private begin() { this.controller.abort(); this.controller = new AbortController(); clearTimeout(this.timer); return ++this.generation; }
  private current(generation: number) { return generation === this.generation && !this.controller.signal.aborted; }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.snapshot.connected || this.suspended) return;
    this.timer = setTimeout(() => void this.refresh(), this.visible && !this.snapshot.error ? 20000 : 300000);
    this.timer.unref();
  }
  async restore() {
    try {
      const saved = this.vault.read();
      if (saved) await this.connect(saved, saved);
    } catch { this.publish({ error: 'Não foi possível ler a credencial salva. Reconecte sua conta Tuya.' }); }
  }
  async connect(input: unknown, saved?: ElginCredentials) {
    const fields: Record<string, unknown> = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
    const accessId = typeof fields.accessId === 'string' ? fields.accessId.trim() : '';
    const accessSecret = typeof fields.accessSecret === 'string' ? fields.accessSecret.trim() : '';
    const region = typeof fields.region === 'string' ? fields.region : '';
    if (!/^\S{8,64}$/.test(accessId) || !/^\S{8,128}$/.test(accessSecret)) {
      this.publish({ error: 'Informe o Access ID e o Access Secret do projeto Tuya.' }); return this.get();
    }
    if (!(elginRegions as readonly string[]).includes(region)) {
      this.publish({ error: 'Escolha a região em que o projeto Tuya foi criado (o Brasil costuma responder em Western America).' }); return this.get();
    }
    const generation = this.begin();
    this.credentials = null; this.client = null;
    this.publish({ ...structuredClone(emptyElgin), busy: true });
    const credentials: ElginCredentials = { accessId, accessSecret, region: region as ElginRegion, selectedId: saved?.selectedId ?? null };
    const client = this.makeClient(credentials);
    const signal = this.controller.signal;
    try {
      const devices = await client.devices(signal);
      if (!this.current(generation)) return this.get();
      if (!devices.length) throw new ElginError('Nenhum ar-condicionado encontrado. Confira o vínculo da conta no projeto Tuya.');
      const selectedId = devices.find(d => d.id === credentials.selectedId)?.id ?? devices[0].id;
      credentials.selectedId = selectedId;
      // A gravação e o commit da sessão são síncronos: uma desconexão não perde a corrida com a credencial.
      this.vault.write(credentials);
      this.credentials = credentials; this.client = client;
      this.publish({ connected: true, devices, selectedId });
      const caps = await client.profile(selectedId, signal);
      const state = await client.state(selectedId, signal);
      if (this.current(generation)) this.publish({ capabilities: caps, state, updatedAt: Date.now() });
    } catch (error) { if (this.current(generation)) this.publish({ error: publicError(error) }); }
    finally { if (this.current(generation)) { this.publish({ busy: false }); this.schedule(); } }
    return this.get();
  }
  disconnect() {
    this.begin(); this.credentials = null; this.client = null;
    let error: string | null = null;
    try { this.vault.clear(); } catch { error = 'A sessão foi encerrada, mas não foi possível apagar a credencial do disco. Tente desconectar novamente.'; }
    this.publish({ ...structuredClone(emptyElgin), error });
    return this.get();
  }
  async select(id: unknown) {
    if (typeof id !== 'string' || !this.snapshot.devices.some(d => d.id === id) || !this.credentials || !this.client) return this.get();
    this.begin();
    this.credentials.selectedId = id;
    try { this.vault.write(this.credentials); } catch { this.publish({ error: 'Não foi possível salvar a seleção do aparelho.' }); }
    this.publish({ selectedId: id, state: null, capabilities: null, busy: false, updatedAt: null });
    return this.refresh();
  }
  async refresh() {
    if (!this.client || !this.snapshot.selectedId || this.snapshot.busy || this.suspended) return this.get();
    const generation = this.generation, signal = this.controller.signal;
    const client = this.client, id = this.snapshot.selectedId;
    this.publish({ busy: true, error: null });
    try {
      const caps = this.snapshot.capabilities ?? await client.profile(id, signal);
      const state = await client.state(id, signal);
      if (this.current(generation)) this.publish({ capabilities: caps, state, updatedAt: Date.now(), notice: null });
    } catch (error) { if (this.current(generation)) this.publish({ error: publicError(error) }); }
    finally { if (this.current(generation)) { this.publish({ busy: false }); this.schedule(); } }
    return this.get();
  }
  async command(id: unknown, input: unknown) {
    const { state, capabilities: caps, selectedId } = this.snapshot;
    if (!this.client || !state || !caps || id !== selectedId || this.snapshot.busy || this.snapshot.error || this.suspended) return this.get();
    let payload: { code: string; value: boolean | string | number };
    try { payload = commandPayload(input, caps, state); }
    catch (error) { this.publish({ error: publicError(error) }); return this.get(); }
    const command = input as ElginCommand;
    if (matchesCommand(state, command)) return this.get();
    const generation = this.generation, signal = this.controller.signal, client = this.client;
    clearTimeout(this.timer);
    this.publish({ busy: true, error: null, notice: 'Enviando comando…' });
    try {
      await client.send(selectedId!, payload, signal);
      if (!this.current(generation)) return this.get();
      this.publish({ notice: 'Comando enviado. Aguardando confirmação do aparelho…' });
      await this.settle(signal);
      if (!this.current(generation)) return this.get();
      const confirmed = await client.state(selectedId!, signal);
      if (this.current(generation)) this.publish({ state: confirmed, updatedAt: Date.now(), notice: matchesCommand(confirmed, command) ? null : 'O aparelho ainda não confirmou a alteração. Atualize em alguns segundos.' });
    } catch (error) { if (this.current(generation)) this.publish({ error: publicError(error), notice: 'O resultado do comando não foi confirmado. Atualize antes de tentar novamente.' }); }
    finally { if (this.current(generation)) { this.publish({ busy: false }); this.schedule(); } }
    return this.get();
  }
  setVisible(value: boolean) { this.visible = value; if (!this.snapshot.busy) this.schedule(); }
  suspend() { this.suspended = true; this.begin(); this.publish({ busy: false }); }
  resume() { this.suspended = false; void this.refresh(); }
  dispose() { this.begin(); }
}
