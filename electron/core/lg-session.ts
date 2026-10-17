import { randomUUID } from 'node:crypto';
import { energyPeriods, type EnergyReport } from '../../shared/energy';
import { setTimeout as delay } from 'node:timers/promises';
import { emptyLG, type LGCommand, type LGSnapshot } from '../../shared/lg';
import { commandPayload, LGClient, LGError, matchesCommand, publicError, type LGTransport } from './lg-client';

export interface Credentials { token: string; clientId: string; selectedId: string | null }
export interface CredentialStore { read(): Credentials | null; write(value: Credentials): void; clear(): void }

export class LGSession {
  private snapshot: LGSnapshot = structuredClone(emptyLG);
  private credentials: Credentials | null = null;
  private client: LGTransport | null = null;
  private controller = new AbortController();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private suspended = false;
  private energyCache: { day: string; report: EnergyReport } | null = null;
  private energyPending: { generation: number; id: string; promise: Promise<EnergyReport> } | null = null;
  constructor(
    private readonly vault: CredentialStore,
    private readonly emit: (snapshot: LGSnapshot) => void,
    private readonly makeClient: (token: string, id: string) => LGTransport = (token, id) => new LGClient(token, id),
    private readonly settle: (signal: AbortSignal) => Promise<unknown> = signal => delay(3000, undefined, { signal }),
  ) {}
  get() { return structuredClone(this.snapshot); }
  private publish(patch: Partial<LGSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.emit(this.get()); }
  private begin() { this.controller.abort(); this.controller = new AbortController(); clearTimeout(this.timer); this.energyCache = null; this.energyPending = null; return ++this.generation; }
  async energy(id: unknown): Promise<EnergyReport> {
    const fail = (error: string): EnergyReport => ({ deviceId: typeof id === 'string' ? id : '', daily: [], monthly: [], supported: true, updatedAt: Date.now(), error });
    if (typeof id !== 'string' || id !== this.snapshot.selectedId || !this.client?.energy || !this.snapshot.connected || this.suspended) return fail('Selecione um aparelho conectado para consultar o consumo.');
    const today = energyPeriods().today;
    if (this.energyCache?.report.deviceId === id && this.energyCache.day === today && Date.now() - this.energyCache.report.updatedAt < 300000) return structuredClone(this.energyCache.report);
    if (this.energyPending?.generation === this.generation && this.energyPending.id === id) return this.energyPending.promise;
    const generation = this.generation;
    const promise = this.client.energy(id, this.controller.signal).then(report => {
      if (!this.current(generation)) return fail('A sessão mudou. Abra o consumo novamente.');
      this.energyCache = { day: today, report }; return structuredClone(report);
    }).catch(error => fail(publicError(error))).finally(() => { if (this.energyPending?.generation === generation) this.energyPending = null; });
    this.energyPending = { generation, id, promise }; return promise;
  }
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
      if (saved) await this.connect(saved.token, saved);
    } catch { this.publish({ error: 'Não foi possível ler a credencial salva. Reconecte sua conta LG.' }); }
  }
  async connect(token: unknown, saved?: Credentials) {
    if (typeof token !== 'string' || !/^thinqpat_[^\s]{8,4096}$/.test(token.trim())) {
      this.publish({ error: 'Cole um token pessoal LG válido, começando com thinqpat_.' }); return this.get();
    }
    const generation = this.begin();
    this.credentials = null; this.client = null;
    this.publish({ ...structuredClone(emptyLG), busy: true });
    const credentials: Credentials = { token: token.trim(), clientId: saved?.clientId ?? `glacialpoint-${randomUUID()}`, selectedId: saved?.selectedId ?? null };
    const client = this.makeClient(credentials.token, credentials.clientId);
    const signal = this.controller.signal;
    try {
      const devices = await client.devices(signal);
      if (!this.current(generation)) return this.get();
      if (!devices.length) throw new LGError('Nenhum ar-condicionado encontrado. Use a mesma conta do aplicativo LG ThinQ e confira as permissões do token.');
      const selectedId = devices.find(d => d.id === credentials.selectedId)?.id ?? devices[0].id;
      credentials.selectedId = selectedId;
      // Saving and session commit are synchronous, so a disconnect cannot race a late credential write.
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
    this.publish({ ...structuredClone(emptyLG), error });
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
    let payload: Record<string, unknown>;
    try { payload = commandPayload(input, caps, state); }
    catch (error) { this.publish({ error: publicError(error) }); return this.get(); }
    const command = input as LGCommand;
    if (matchesCommand(state, command)) return this.get();
    const generation = this.generation, signal = this.controller.signal, client = this.client;
    clearTimeout(this.timer);
    this.publish({ busy: true, error: null, notice: 'Enviando comando…' });
    try {
      await client.send(selectedId!, payload, signal);
      if (!this.current(generation)) return this.get();
      this.publish({ notice: 'Comando enviado. Aguardando confirmação da LG…' });
      await this.settle(signal);
      if (!this.current(generation)) return this.get();
      const confirmed = await client.state(selectedId!, signal);
      if (this.current(generation)) this.publish({ state: confirmed, updatedAt: Date.now(), notice: matchesCommand(confirmed, command) ? null : 'A LG ainda não confirmou a alteração. Atualize em alguns segundos.' });
    } catch (error) { if (this.current(generation)) this.publish({ error: publicError(error), notice: 'O resultado do comando não foi confirmado. Atualize antes de tentar novamente.' }); }
    finally { if (this.current(generation)) { this.publish({ busy: false }); this.schedule(); } }
    return this.get();
  }
  setVisible(value: boolean) { this.visible = value; if (!this.snapshot.busy) this.schedule(); }
  suspend() { this.suspended = true; this.begin(); this.publish({ busy: false }); }
  resume() { this.suspended = false; void this.refresh(); }
  dispose() { this.begin(); }
}
