import { randomUUID } from 'node:crypto';
import { energyPeriods, type EnergyReport } from '../../shared/energy';
import { setTimeout as delay } from 'node:timers/promises';
import { emptyLG, type LGCommand, type LGRealtime, type LGState, type LGSnapshot } from '../../shared/lg';
import { at, bool, commandPayload, LGClient, LGError, matchesCommand, number, publicError, string, type LGTransport } from './lg-client';
import { LGPush, type LGPushLink, type LGPushOptions, type LGPushStatus } from './lg-push';

export interface Credentials { token: string; clientId: string; selectedId: string | null }
export interface CredentialStore { read(): Credentials | null; write(value: Credentials): void; clear(): void }

export type LGPushFactory = (options: LGPushOptions) => LGPushLink;

export class LGSession {
  private snapshot: LGSnapshot = structuredClone(emptyLG);
  private credentials: Credentials | null = null;
  private client: LGTransport | null = null;
  private controller = new AbortController();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private suspended = false;
  private push: LGPushLink | null = null;
  private pushState: LGPushStatus = 'stopped';
  private pushedAt: number | null = null;
  private energyCache: { day: string; report: EnergyReport } | null = null;
  private energyPending: { generation: number; id: string; promise: Promise<EnergyReport> } | null = null;
  constructor(
    private readonly vault: CredentialStore,
    private readonly emit: (snapshot: LGSnapshot) => void,
    private readonly makeClient: (token: string, id: string) => LGTransport = (token, id) => new LGClient(token, id),
    private readonly settle: (signal: AbortSignal) => Promise<unknown> = signal => delay(3000, undefined, { signal }),
    private readonly makePush: LGPushFactory = options => new LGPush(options),
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
  private startPush() {
    this.stopPush();
    if (this.suspended || !this.credentials || !this.snapshot.connected || !this.snapshot.selectedId) return;
    const { token, clientId } = this.credentials;
    this.push = this.makePush({
      token, clientId, deviceId: this.snapshot.selectedId,
      onReport: report => this.applyPush(report), onStatus: status => this.setPushStatus(status),
    });
    this.push.start();
  }
  private stopPush() {
    const push = this.push; this.push = null;
    if (push) push.stop();
    this.setPushStatus('stopped');
  }
  private setPushStatus(status: LGPushStatus) {
    if (this.pushState === status) return;
    this.pushState = status;
    const realtime: LGRealtime | null = status === 'connected' ? 'on' : status === 'blocked' ? 'blocked' : status === 'connecting' || status === 'reconnecting' ? 'connecting' : null;
    this.publish({ realtime });
  }
  // Relatórios do canal de tempo real entram no estado como leitura
  // confirmada do aparelho (nunca como alteração otimista): só os campos
  // presentes na mensagem mudam, e uma repetição sem mudança não toca no
  // relógio. (O Elgin aplica a mesma regra em elgin-session.ts.)
  private applyPush(report: Record<string, unknown>) {
    const { connected, state } = this.snapshot;
    if (!connected || this.suspended) return;
    this.pushedAt = Date.now(); // a nuvem falou: o canal está comprovado
    if (!state) return;
    const operation = at(report, 'operation', 'airConOperationMode');
    // Se vier em Fahrenheit (conta em outra unidade), os números não entram.
    const unit = at(report, 'temperature', 'unit');
    const celsius = unit === undefined || unit === 'C';
    const sleep = at(report, 'sleepTimer');
    let sleepHours = state.sleepHours;
    if (sleep !== undefined && sleep !== null) {
      sleepHours = at(report, 'sleepTimer', 'relativeStopTimer') === 'UNSET' ? 0
        : Math.ceil(((number(at(report, 'sleepTimer', 'relativeHourToStop')) ?? 0) * 60 + (number(at(report, 'sleepTimer', 'relativeMinuteToStop')) ?? 0)) / 60) || null;
    }
    const next: LGState = {
      power: operation === 'POWER_ON' ? true : operation === 'POWER_OFF' ? false : state.power,
      mode: string(at(report, 'airConJobMode', 'currentJobMode')) ?? state.mode,
      current: celsius ? number(at(report, 'temperature', 'currentTemperature')) ?? state.current : state.current,
      target: celsius ? number(at(report, 'temperature', 'targetTemperature')) ?? state.target : state.target,
      fan: string(at(report, 'airFlow', 'windStrength')) ?? state.fan,
      swing: bool(at(report, 'windDirection', 'rotateUpDown')) ?? state.swing,
      eco: bool(at(report, 'powerSave', 'powerSaveEnabled')) ?? state.eco,
      sleepHours,
    };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    this.publish({ state: next, updatedAt: Date.now() });
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.snapshot.connected || this.suspended) return;
    // O polling vira rede de segurança (5 min) só depois que uma mensagem real
    // chegar: se a LG não liberar o canal de tempo real, o app continua no
    // ritmo normal de 20 s.
    const live = this.pushState === 'connected' && this.pushedAt !== null;
    const interval = live ? (this.snapshot.error ? 20000 : 300000) : (this.visible && !this.snapshot.error ? 20000 : 300000);
    this.timer = setTimeout(() => void this.refresh(), interval);
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
    this.stopPush();
    this.pushedAt = null;
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
    this.publish({ ...structuredClone(emptyLG), error });
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
  // Abrir o painel mostra o estado atual: se a última leitura já passou de
  // 10 s, consulta na hora em vez de esperar o próximo ciclo (20 s / 5 min).
  setVisible(value: boolean) {
    const opening = value && !this.visible;
    this.visible = value;
    if (this.snapshot.busy) return;
    this.schedule();
    if (opening && this.snapshot.connected && Date.now() - (this.snapshot.updatedAt ?? 0) > 10000) void this.refresh();
  }
  suspend() { this.suspended = true; this.begin(); this.stopPush(); this.publish({ busy: false }); }
  resume() { this.suspended = false; this.startPush(); void this.refresh(); }
  dispose() { this.stopPush(); this.begin(); }
}
