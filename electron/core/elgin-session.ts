import { setTimeout as delay } from 'node:timers/promises';
import { defaultAveragePower, type EnergyReport } from '../../shared/energy';
import { elginRegions, emptyElgin, type ElginCommand, type ElginCredentials, type ElginProject, type ElginRegion, type ElginRealtime, type ElginSnapshot } from '../../shared/elgin';
import { commandPayload, ElginClient, ElginError, matchesCommand, publicError, type ElginTransport } from './elgin-client';
import { ElginPush, type ElginPushLink, type ElginPushOptions, type ElginPushStatus } from './elgin-push';
import { buildEstimate, dayOf, mergeUsage, switchEvents, usageByDay, usageWindowStart, type ElginUsageStore } from './elgin-energy';

export interface ElginCredentialStore { read(): ElginCredentials | null; write(value: ElginCredentials): void; clear(): void }

export type ElginPushFactory = (options: ElginPushOptions) => ElginPushLink;

export class ElginSession {
  private snapshot: ElginSnapshot = structuredClone(emptyElgin);
  private credentials: ElginCredentials | null = null;
  private client: ElginTransport | null = null;
  private controller = new AbortController();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private suspended = false;
  private push: ElginPushLink | null = null;
  private pushState: ElginPushStatus = 'stopped';
  private pushedAt: number | null = null;
  private energyCache: { day: string; id: string; at: number; seconds: Record<string, number> } | null = null;
  private energyPending: { generation: number; id: string; promise: Promise<EnergyReport> } | null = null;
  constructor(
    private readonly vault: ElginCredentialStore,
    private readonly emit: (snapshot: ElginSnapshot) => void,
    private readonly makeClient: (project: ElginProject) => ElginTransport = project => new ElginClient(project),
    private readonly settle: (signal: AbortSignal) => Promise<unknown> = signal => delay(3000, undefined, { signal }),
    private readonly makePush: ElginPushFactory = options => new ElginPush(options),
    // Acumulado diário da estimativa de consumo (energy-estimate.json); em
    // memória quando omitido (testes).
    private readonly usage: ElginUsageStore = { read: () => ({}), write: () => {} },
  ) {}
  get() { return structuredClone(this.snapshot); }
  private publish(patch: Partial<ElginSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.emit(this.get()); }
  private begin() { this.controller.abort(); this.controller = new AbortController(); clearTimeout(this.timer); this.energyCache = null; this.energyPending = null; return ++this.generation; }
  private current(generation: number) { return generation === this.generation && !this.controller.signal.aborted; }
  private startPush() {
    this.stopPush();
    if (this.suspended || !this.credentials || !this.snapshot.connected || !this.snapshot.selectedId) return;
    const { accessId, accessSecret, region } = this.credentials;
    this.push = this.makePush({
      project: { accessId, accessSecret, region }, deviceId: this.snapshot.selectedId,
      onValues: values => this.applyPush(values), onStatus: status => this.setPushStatus(status),
    });
    this.push.start();
  }
  private stopPush() {
    const push = this.push; this.push = null;
    if (push) push.stop();
    this.setPushStatus('stopped');
  }
  private setPushStatus(status: ElginPushStatus) {
    if (this.pushState === status) return;
    this.pushState = status;
    const realtime: ElginRealtime | null = status === 'connected' ? 'on' : status === 'unauthorized' ? 'blocked' : status === 'connecting' || status === 'reconnecting' ? 'connecting' : null;
    this.publish({ realtime });
  }
  // Relatórios vindos do push entram no estado como leitura confirmada do
  // aparelho (nunca como alteração otimista): só os campos presentes na
  // mensagem mudam, e uma repetição sem mudança não toca no relógio.
  private applyPush(values: Record<string, unknown>) {
    const { connected, capabilities: caps, state } = this.snapshot;
    if (!connected || this.suspended) return;
    this.pushedAt = Date.now(); // a nuvem falou: o canal está comprovado
    if (!state) return;
    const scale = caps?.temperature?.scale ?? 1;
    const temperature = (raw: unknown, current: number | null) => typeof raw === 'number' && Number.isFinite(raw) ? raw / 10 ** scale : current;
    const flag = (raw: unknown, current: boolean | null) => typeof raw === 'boolean' ? raw : current;
    const next = {
      power: flag(values.switch, state.power),
      mode: typeof values.mode === 'string' ? values.mode : state.mode,
      current: temperature(values.temp_current, state.current),
      target: temperature(values.temp_set, state.target),
      eco: flag(values.mode_eco, state.eco),
      sleep: flag(values.sleep, state.sleep),
      light: flag(values.light, state.light),
      lock: flag(values.lock, state.lock),
      swingHorizontal: flag(values.switch_horizontal, state.swingHorizontal),
    };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    this.publish({ state: next, updatedAt: Date.now() });
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.snapshot.connected || this.suspended) return;
    // O polling vira rede de segurança (5 min) só depois que uma mensagem real
    // chegar: se o serviço de mensagens estiver desligado no projeto, o app
    // continua no ritmo normal de 20 s.
    const live = this.pushState === 'connected' && this.pushedAt !== null;
    const interval = live ? (this.snapshot.error ? 20000 : 300000) : (this.visible && !this.snapshot.error ? 20000 : 300000);
    this.timer = setTimeout(() => void this.refresh(), interval);
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
    this.stopPush();
    this.pushedAt = null;
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
      this.startPush();
      const caps = await client.profile(selectedId, signal);
      const state = await client.state(selectedId, signal);
      if (this.current(generation)) this.publish({ capabilities: caps, state, updatedAt: Date.now() });
    } catch (error) { if (this.current(generation)) this.publish({ error: publicError(error) }); }
    finally { if (this.current(generation)) { this.publish({ busy: false }); this.schedule(); } }
    return this.get();
  }
  disconnect() {
    this.begin(); this.stopPush(); this.pushedAt = null; this.credentials = null; this.client = null;
    let error: string | null = null;
    try { this.vault.clear(); } catch { error = 'A sessão foi encerrada, mas não foi possível apagar a credencial do disco. Tente desconectar novamente.'; }
    this.publish({ ...structuredClone(emptyElgin), error });
    return this.get();
  }
  async select(id: unknown) {
    if (typeof id !== 'string' || !this.snapshot.devices.some(d => d.id === id) || !this.credentials || !this.client) return this.get();
    this.begin();
    this.stopPush();
    this.credentials.selectedId = id;
    try { this.vault.write(this.credentials); } catch { this.publish({ error: 'Não foi possível salvar a seleção do aparelho.' }); }
    this.publish({ selectedId: id, state: null, capabilities: null, busy: false, updatedAt: null });
    const result = await this.refresh();
    this.startPush();
    return result;
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
  // O Elgin não mede energia: o consumo é estimado pelo tempo ligado nos logs
  // de DP (janela gratuita de 7 dias) × consumo médio configurado. Dias fora da
  // janela ficam congelados no armazenamento local (energy-estimate.json).
  async energy(id: unknown, averagePower = defaultAveragePower): Promise<EnergyReport> {
    const fail = (error: string): EnergyReport => ({ deviceId: typeof id === 'string' ? id : '', daily: [], monthly: [], supported: true, updatedAt: Date.now(), error, source: 'estimate' });
    const client = this.client, logs = client?.logs?.bind(client);
    if (typeof id !== 'string' || id !== this.snapshot.selectedId || !logs || !this.snapshot.connected || this.suspended) return fail('Selecione um aparelho conectado para consultar o consumo.');
    const now = Date.now(), day = dayOf(now);
    const cache = this.energyCache;
    if (cache?.id === id && cache.day === day && now - cache.at < 300000) return buildEstimate(id, cache.seconds, averagePower, cache.at);
    if (this.energyPending?.generation === this.generation && this.energyPending.id === id) return this.energyPending.promise;
    const generation = this.generation, signal = this.controller.signal, from = usageWindowStart(now);
    const promise = logs(id, { start: from, end: now, codes: 'switch' }, signal).then(entries => {
      if (!this.current(generation)) return fail('A sessão mudou. Abra o consumo novamente.');
      const fresh = usageByDay(switchEvents(entries), { from, to: now, currentPower: this.snapshot.state?.power ?? null });
      const seconds = mergeUsage(this.usage.read(), fresh);
      try { this.usage.write(seconds); } catch { /* a estimativa continua válida em memória */ }
      this.energyCache = { day, id, at: now, seconds };
      return buildEstimate(id, seconds, averagePower, now);
    }).catch(error => fail(publicError(error))).finally(() => { if (this.energyPending?.generation === generation) this.energyPending = null; });
    this.energyPending = { generation, id, promise };
    return promise;
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
  suspend() { this.suspended = true; this.begin(); this.stopPush(); this.publish({ busy: false }); }
  resume() { this.suspended = false; this.startPush(); void this.refresh(); }
  dispose() { this.stopPush(); this.begin(); }
}
