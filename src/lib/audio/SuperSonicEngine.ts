import type { SuperSonic, osc as OscUtilities } from 'supersonic-scsynth';
import type { InstrumentDefinition, InstrumentEvent } from '../instruments/types';
import { getInstrument } from '../instruments/registry';
import { DEFAULT_LOOKAHEAD, type AudioDiagnostics, type AudioPlan } from './types';

type PendingRequest = { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };

/** Owns all synthesis and OSC; the UI only supplies musical plans and instruments. */
export class SuperSonicEngine {
  private sonic?: SuperSonic;
  private osc?: typeof OscUtilities;
  private worker?: Worker;
  private analyser?: AnalyserNode;
  private analyserSource?: AudioWorkletNode;
  private samples = new Float32Array(2048);
  private listeners = new Set<() => void>();
  private requests = new Map<number, PendingRequest>();
  private syncs = new Map<number, PendingRequest>();
  private sequence = 0;
  private group = 0;
  private origin = 0;
  private stoppedPosition = 0;
  private plan?: AudioPlan;
  private active = false;
  private initialized = false;
  private initialization?: Promise<void>;
  private status: AudioDiagnostics['status'] = 'idle';
  private error = '';
  private scheduled = 0;
  private missed = 0;
  private dropped = 0;
  private sampleSlots = new Map<string, number>();
  private onDeviceChange = () => {
    this.error = 'Audio devices changed. Use Recover audio engine if the output is interrupted.';
    this.notify();
  };
  readonly lookahead: number;

  constructor(options: { lookahead?: number } = {}) {
    this.lookahead = Math.max(0.05, Math.min(0.5, options.lookahead ?? DEFAULT_LOOKAHEAD));
  }

  get ready() { return this.initialized; }
  get playing() { return this.active; }
  get position(): number {
    const raw = this.active ? Math.max(this.stoppedPosition, this.now() - this.origin) : this.stoppedPosition;
    if (this.plan?.loop && this.plan.duration > 0) return raw % this.plan.duration;
    return Math.min(raw, this.plan?.duration ?? raw);
  }

  /** Future musical boundary past every bundle the worker could already have sent. */
  committedPosition(): number {
    const position = this.position;
    return Math.min(this.plan?.duration ?? Infinity, position + this.lookahead + 0.07);
  }

  get diagnostics(): AudioDiagnostics {
    let rms = 0, peak = 0;
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      for (const sample of this.samples) { rms += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      rms = Math.sqrt(rms / this.samples.length);
    }
    const metrics = this.sonic?.getMetrics();
    return {
      status: this.status, error: this.error, mode: this.sonic?.mode ?? 'offline',
      sampleRate: this.sonic?.audioContext?.sampleRate ?? 0,
      rms, peak, scheduled: this.scheduled, missed: this.missed,
      dropped: this.dropped + (metrics?.engineSchedulerDropped ?? 0) + (metrics?.engineMessagesDropped ?? 0),
      queueDepth: metrics?.engineSchedulerDepth ?? 0,
      late: metrics?.engineSchedulerLates ?? 0,
      maxLateMs: metrics?.engineSchedulerMaxLateMs ?? 0,
      lookahead: this.lookahead
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => { this.listeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) listener(); }
  private fail(error: unknown) {
    this.error = error instanceof Error ? error.message : String(error);
    this.status = 'error';
    this.notify();
  }
  private now() { return this.sonic?.clock?.now() ?? 0; }

  /** Must be called from a click/tap. No engine code executes during SSR. */
  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.initialization = this.boot().finally(() => { this.initialization = undefined; });
    return this.initialization;
  }

  private async boot() {
    if (typeof window === 'undefined') throw new Error('SuperSonic audio is available only in a browser.');
    this.status = 'loading'; this.error = ''; this.notify();
    try {
      const { SuperSonic, osc } = await import('supersonic-scsynth');
      this.osc = osc;
      const sonic = this.sonic = new SuperSonic({
        workerBaseURL: '/supersonic/workers/',
        coreBaseURL: '/supersonic-core/',
        synthdefBaseURL: '/synthdefs/',
        audioContextOptions: { latencyHint: 'interactive', sampleRate: 48000 }
      });
      sonic.on('error', (error) => this.fail(error));
      sonic.on('warning', ({ message }) => { this.error = message; this.notify(); });
      sonic.on('in', (message) => {
        if (message[0] === '/synced') {
          const id = Number(message[1]);
          const pending = this.syncs.get(id);
          if (pending) { clearTimeout(pending.timeout); this.syncs.delete(id); pending.resolve(undefined); }
        } else if (message[0] === '/fail') this.fail(new Error(`SuperSonic ${message.slice(1).join(': ')}`));
      });
      const suspended = () => {
        this.stoppedPosition = this.position;
        this.active = false;
        this.worker?.postMessage({ type: 'halt', syncId: ++this.sequence });
        this.status = 'suspended'; this.notify();
      };
      sonic.on('audiocontext:suspended', suspended);
      sonic.on('audiocontext:interrupted', suspended);
      sonic.on('setup', async () => {
        this.group = sonic.nextNodeId();
        sonic.send('/g_new', this.group, 0, 0);
        await sonic.sync();
      });
      await sonic.init();
      this.attachAnalyser();
      await this.attachWorker();
      this.initialized = true;
      navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
      this.status = 'ready'; this.notify();
    } catch (error) {
      this.fail(error);
      this.worker?.terminate(); this.worker = undefined;
      await this.sonic?.destroy(); this.sonic = undefined;
      throw error;
    }
  }

  private attachAnalyser() {
    if (this.analyser && this.analyserSource) {
      try { this.analyserSource.disconnect(this.analyser); } catch { /* A reload may already have detached the old worklet. */ }
    }
    this.analyser?.disconnect();
    const context = this.sonic?.audioContext;
    if (!context || !this.sonic?.node) return;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = this.samples.length;
    // input is the documented underlying AudioWorkletNode (and its output).
    // The wrapper's published TS connect overload currently only accepts AudioParam.
    this.sonic.node.input.connect(this.analyser);
    this.analyserSource = this.sonic.node.input;
  }

  private async attachWorker() {
    const sonic = this.sonic;
    if (!sonic) throw new Error('Audio engine is unavailable');
    await this.releaseWorker();
    this.worker = new Worker(new URL('./scheduler.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onerror = (event) => { this.active = false; this.fail(new Error(`Scheduler worker: ${event.message}`)); };
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'metrics') {
        this.scheduled = data.scheduled; this.missed = data.missed; this.dropped = data.dropped;
      } else if (data.type === 'ended') {
        this.active = false; this.stoppedPosition = this.plan?.duration ?? 0; this.status = 'ready'; this.notify();
      }
      const request = this.requests.get(data.requestId);
      if (data.type === 'error' && data.fatal) { this.active = false; this.fail(new Error(data.error)); }
      if (request) {
        clearTimeout(request.timeout); this.requests.delete(data.requestId);
        if (data.type === 'error') request.reject(new Error(data.error));
        else request.resolve(data);
      } else if (data.type === 'error') this.fail(new Error(data.error));
    };
    const channel = sonic.createOscChannel();
    await this.request({ type: 'init', channel: channel.transferable, group: this.group, lookahead: this.lookahead }, channel.transferList);
  }

  private request(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> {
    if (!this.worker) return Promise.reject(new Error('Scheduler is unavailable. Initialize or recover audio first.'));
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.requests.delete(requestId); reject(new Error(`Scheduler ${message.type} timed out.`)); }, 6000);
      this.requests.set(requestId, { resolve, reject, timeout });
      this.worker!.postMessage({ ...message, requestId }, transfer);
    });
  }

  async loadSynthDef(path: string): Promise<void> {
    if (!this.sonic) throw new Error('Initialize audio before loading instruments.');
    try { await this.sonic.loadSynthDef(path); }
    catch (error) { throw new Error(`Could not load SynthDef ${path}: ${error instanceof Error ? error.message : error}`); }
  }
  async loadSample(path: string, bufferNumber?: number) {
    if (!this.sonic) throw new Error('Initialize audio before loading samples.');
    const existing = this.sampleSlots.get(path);
    if (existing !== undefined) return this.sonic.getLoadedBuffers().find((buffer) => buffer.bufnum === existing);
    const slot = bufferNumber ?? Math.max(-1, ...this.sonic.getLoadedBuffers().map((buffer) => buffer.bufnum)) + 1;
    const result = await this.sonic.loadSample(slot, path);
    this.sampleSlots.set(path, slot);
    return result;
  }
  private async prepare(plan: AudioPlan) {
    if (!Number.isFinite(plan.duration) || plan.duration <= 0) throw new Error('Composition duration must be positive.');
    for (const track of plan.tracks) {
      const instrument = getInstrument(track.instrumentId);
      const path = track.synthDefPath ?? instrument.synthDefPath;
      if (!this.sonic?.loadedSynthDefs.has(track.synthDefName)) await this.loadSynthDef(path);
      for (const sample of instrument.initialization?.samples ?? []) await this.loadSample(sample);
    }
  }

  async play(plan: AudioPlan, position = this.stoppedPosition) {
    await this.initialize();
    if (this.status === 'suspended') throw new Error('Audio was suspended. Use Recover audio before playing.');
    if (this.active) await this.pause();
    await this.prepare(plan);
    this.plan = plan;
    this.stoppedPosition = Math.max(0, Math.min(position, plan.duration));
    if (this.stoppedPosition === plan.duration) this.stoppedPosition = 0;
    this.origin = this.now() + 0.06 - this.stoppedPosition;
    await this.request({ type: 'play', plan, position: this.stoppedPosition, origin: this.origin });
    this.active = true; this.status = 'playing'; this.error = ''; this.notify();
  }

  /** Retain old committed notes, switch every track at the same future boundary. */
  async update(plan: AudioPlan, boundary = this.committedPosition()) {
    if (!this.active) { this.plan = plan; return; }
    await this.prepare(plan);
    const raw = Math.max(0, this.now() - this.origin);
    const cycle = this.plan?.loop ? Math.floor(raw / this.plan.duration) : 0;
    const at = cycle * (this.plan?.duration ?? 0) + boundary;
    await this.request({ type: 'update', plan, at });
    this.plan = plan;
  }

  private async haltAndPurge() {
    if (!this.worker || !this.sonic) return;
    const syncId = ++this.sequence + 1000000;
    const barrier = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.syncs.delete(syncId); reject(new Error('Audio worker drain timed out. Recover audio to reconnect.')); }, 3000);
      this.syncs.set(syncId, { resolve, reject, timeout });
    });
    // Observe both promises immediately; a worker failure must not leave an
    // unhandled rejection from the independently timed engine barrier.
    await Promise.all([this.request({ type: 'halt', syncId }), barrier]);
    await this.sonic.purge();
    this.sonic.send('/g_freeAll', this.group);
  }

  async pause() {
    this.stoppedPosition = this.position;
    this.active = false;
    await this.haltAndPurge();
    this.status = 'ready'; this.notify();
  }
  async stop() { await this.pause(); this.stoppedPosition = 0; this.notify(); }
  async seek(position: number) {
    const restart = this.active;
    await this.pause();
    this.stoppedPosition = Math.max(0, Math.min(position, this.plan?.duration ?? position));
    if (restart && this.plan) await this.play(this.plan, this.stoppedPosition);
    this.notify();
  }

  async audition(instrument: InstrumentDefinition, parameters: Record<string, number> = {}, event: Partial<InstrumentEvent> = {}) {
    await this.initialize();
    if (!this.sonic || !this.osc) throw new Error('Audio engine is unavailable');
    if (!this.sonic.loadedSynthDefs.has(instrument.synthDefName)) await this.loadSynthDef(instrument.synthDefPath);
    const mapped = instrument.mapEvent({ pitch: event.pitch ?? 48, velocity: event.velocity ?? 0.8, duration: event.duration ?? 0.3, parameters });
    this.sonic.sendOSC(this.osc.encodeSingleBundle(this.now() + 0.035, '/s_new', [
      instrument.synthDefName, this.sonic.nextNodeId(), 0, this.group, ...Object.entries(mapped).flat()
    ]));
  }

  setNodeParameters(nodeId: number, parameters: Record<string, number>) {
    this.sonic?.send('/n_set', nodeId, ...Object.entries(parameters).flat());
  }

  async recover() {
    if (!this.sonic) return this.initialize();
    this.stoppedPosition = this.position; this.active = false;
    const releasing = this.releaseWorker();
    // Invoked synchronously in the gesture so SuperSonic can create its spare context.
    const recovery = this.sonic.recover();
    await releasing;
    if (!(await recovery)) { const error = new Error('Audio recovery failed. Reload the page to reconnect.'); this.fail(error); throw error; }
    await this.sonic.purge();
    this.attachAnalyser();
    await this.attachWorker();
    if (this.plan) await this.prepare(this.plan);
    this.status = 'ready'; this.error = ''; this.notify();
  }

  async destroy() {
    this.active = false;
    if (typeof navigator !== 'undefined') navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    await this.releaseWorker();
    for (const pending of [...this.requests.values(), ...this.syncs.values()]) { clearTimeout(pending.timeout); pending.reject(new Error('Audio engine disposed.')); }
    this.requests.clear(); this.syncs.clear();
    await this.sonic?.destroy(); this.sonic = undefined;
    this.analyser = undefined; this.analyserSource = undefined; this.initialized = false; this.status = 'idle';
    this.listeners.clear();
  }

  private async releaseWorker() {
    const worker = this.worker;
    if (!worker) return;
    try { await this.request({ type: 'release' }); }
    finally { worker.terminate(); if (this.worker === worker) this.worker = undefined; }
  }
}
