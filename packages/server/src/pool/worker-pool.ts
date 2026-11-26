import { Worker } from 'node:worker_threads';
import type { JobState, JobView, LaneSegment, PoolCore, WorkerView } from '@yard/shared';
import { isTerminal } from '@yard/shared';
import { defaultPoolSize } from '../config';
import { createId } from '../ids';
import { createCancelFlag, requestCancel } from './cancel';
import { InvalidJobStateError, JobNotFoundError } from './errors';
import { readWorkerMessage } from './protocol';

export interface SubmitInput {
  type: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
  retryOf?: string | null;
  attempt?: number;
}

export interface WorkerPoolOptions {
  workerUrl: URL;
  size?: number;
  jobTimeoutMs?: number;
  cancelGraceMs?: number;
  execArgv?: string[];
  maxJobs?: number;
  now?: () => number;
}

interface Slot {
  id: string;
  generation: number;
  worker: Worker | null;
  status: 'booting' | 'idle' | 'busy';
  jobId: string | null;
  jobType: string | null;
  jobStartedAt: number | null;
  flag: Int32Array | null;
  timeout?: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
  spawnTimer?: ReturnType<typeof setTimeout>;
  bootFailures: number;
}

const MAX_BOOT_FAILURES = 10;

/**
 * Fixed-size worker_threads pool.
 * One job per worker, FIFO queue, cooperative cancel via SharedArrayBuffer,
 * and a hard timeout that terminates and respawns a stuck worker.
 */
export class WorkerPool {
  private readonly size: number;
  private readonly workerUrl: URL;
  private readonly execArgv: string[];
  private readonly jobTimeoutMs: number;
  private readonly cancelGraceMs: number;
  private readonly maxJobs: number;
  private readonly now: () => number;
  private readonly slots: Slot[] = [];
  private readonly jobs = new Map<string, JobView>();
  private readonly order: string[] = [];
  private readonly queue: JobView[] = [];
  private readonly lanes: LaneSegment[] = [];
  private readonly listeners = new Set<(job: JobView) => void>();
  private readonly readyWaiters: Array<() => void> = [];
  private generationCounter = 0;
  private lastStamp = 0;
  private closed = false;
  private readonly totals = { submitted: 0, completed: 0, failed: 0, canceled: 0 };

  constructor(options: WorkerPoolOptions) {
    this.size = Math.max(1, options.size ?? defaultPoolSize());
    this.workerUrl = options.workerUrl;
    this.execArgv = options.execArgv ?? (options.workerUrl.pathname.endsWith('.ts') ? ['--import', 'tsx'] : []);
    this.jobTimeoutMs = options.jobTimeoutMs ?? 30_000;
    this.cancelGraceMs = options.cancelGraceMs ?? 750;
    this.maxJobs = options.maxJobs ?? 500;
    this.now = options.now ?? Date.now;

    for (let index = 1; index <= this.size; index += 1) {
      const slot = this.createSlot(`w${index}`);
      this.slots.push(slot);
      this.spawn(slot);
    }
  }

  submit(input: SubmitInput): JobView {
    if (this.closed) throw new Error('pool is closed');

    const job: JobView = {
      id: createId('job'),
      type: input.type,
      params: { ...(input.params ?? {}) },
      state: 'queued',
      progress: 0,
      message: null,
      result: null,
      error: null,
      timeoutMs: input.timeoutMs ?? this.jobTimeoutMs,
      workerId: null,
      attempt: input.attempt ?? 1,
      retryOf: input.retryOf ?? null,
      cancelRequested: false,
      createdAt: this.stamp(),
      startedAt: null,
      finishedAt: null,
    };

    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.queue.push(job);
    this.totals.submitted += 1;
    this.emit(job);
    this.pump();
    this.trim();
    return cloneJob(job);
  }

  cancel(id: string): JobView {
    const job = this.must(id);
    if (job.state === 'canceled') return cloneJob(job);
    if (job.state === 'completed' || job.state === 'failed') {
      throw new InvalidJobStateError(`cannot cancel a ${job.state} job`);
    }

    if (job.state === 'queued') {
      const index = this.queue.findIndex((item) => item.id === id);
      if (index >= 0) this.queue.splice(index, 1);
      this.finish(job, 'canceled', null);
      return cloneJob(job);
    }

    job.cancelRequested = true;
    const slot = this.slots.find((item) => item.jobId === id);
    if (slot?.flag) requestCancel(slot.flag);
    if (slot?.timeout) {
      clearTimeout(slot.timeout);
      slot.timeout = undefined;
    }
    if (slot && !slot.grace) {
      const generation = slot.generation;
      slot.grace = setTimeout(() => this.forceCancel(slot, id, generation), this.cancelGraceMs);
    }
    this.emit(job);
    return cloneJob(job);
  }

  retry(id: string): JobView {
    const job = this.must(id);
    if (job.state !== 'failed' && job.state !== 'canceled') {
      throw new InvalidJobStateError(`cannot retry a ${job.state} job`);
    }
    return this.submit({
      type: job.type,
      params: { ...job.params },
      timeoutMs: job.timeoutMs,
      retryOf: job.id,
      attempt: job.attempt + 1,
    });
  }

  get(id: string): JobView | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  list(limit = 100): JobView[] {
    const cap = Math.max(0, limit);
    const jobs: JobView[] = [];
    for (let index = this.order.length - 1; index >= 0 && jobs.length < cap; index -= 1) {
      const job = this.jobs.get(this.order[index]!);
      if (job) jobs.push(cloneJob(job));
    }
    return jobs;
  }

  stats(): PoolCore {
    return this.snapshot();
  }

  snapshot(): PoolCore {
    return {
      size: this.size,
      queueDepth: this.queue.length,
      running: this.slots.filter((slot) => slot.status === 'busy').length,
      workers: this.slots.map((slot) => this.workerView(slot)),
      lanes: this.lanes.map((lane) => ({ ...lane })),
      totals: { ...this.totals },
    };
  }

  subscribe(listener: (job: JobView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  whenReady(): Promise<void> {
    if (this.closed || this.slots.every((slot) => slot.status !== 'booting')) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const waiters = this.readyWaiters.splice(0);
    for (const waiter of waiters) waiter();

    await Promise.all(
      this.slots.map(async (slot) => {
        this.clearTimers(slot);
        this.clearSpawn(slot);
        const worker = slot.worker;
        slot.generation += 1;
        slot.worker = null;
        worker?.removeAllListeners();
        if (!worker) return;
        await Promise.race([worker.terminate(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      }),
    );
    this.slots.length = 0;
    this.listeners.clear();
  }

  private createSlot(id: string): Slot {
    return {
      id,
      generation: 0,
      worker: null,
      status: 'booting',
      jobId: null,
      jobType: null,
      jobStartedAt: null,
      flag: null,
      bootFailures: 0,
    };
  }

  private spawn(slot: Slot): void {
    this.clearSpawn(slot);
    const generation = ++this.generationCounter;
    slot.generation = generation;
    slot.status = 'booting';
    slot.jobId = null;
    slot.jobType = null;
    slot.jobStartedAt = null;
    slot.flag = null;

    let worker: Worker;
    try {
      worker = new Worker(this.workerUrl, {
        execArgv: this.execArgv,
        name: slot.id,
      });
    } catch {
      slot.worker = null;
      slot.bootFailures += 1;
      this.scheduleSpawn(slot);
      return;
    }

    slot.worker = worker;
    worker.on('message', (message) => this.onMessage(slot, generation, message));
    worker.on('error', (error) => this.onWorkerError(slot, generation, error));
    worker.on('exit', (code) => this.onExit(slot, generation, code));
  }

  private scheduleSpawn(slot: Slot): void {
    this.clearSpawn(slot);
    if (this.closed || slot.bootFailures > MAX_BOOT_FAILURES) return;
    const delay = slot.bootFailures <= 1 ? 0 : Math.min(500, 30 * slot.bootFailures);
    const generation = slot.generation;
    slot.spawnTimer = setTimeout(() => {
      if (this.closed || slot.generation !== generation) return;
      this.spawn(slot);
    }, delay);
  }

  private onMessage(slot: Slot, generation: number, raw: unknown): void {
    if (this.closed || slot.generation !== generation) return;
    const message = readWorkerMessage(raw);
    if (!message) return;

    if (message.type === 'ready') {
      if (slot.status === 'booting') {
        slot.status = 'idle';
        slot.bootFailures = 0;
        this.notifyReady();
        this.pump();
      }
      return;
    }

    if (slot.jobId !== message.jobId) return;
    const job = this.jobs.get(message.jobId);
    if (!job || isTerminal(job.state)) return;

    if (message.type === 'progress') {
      this.applyProgress(job, message.percent, message.message);
      this.patchLane(job);
      return;
    }

    if (message.type === 'done') {
      this.clearTimers(slot);
      job.result = message.result ?? null;
      job.progress = 100;
      this.finish(job, 'completed', null);
      this.closeLane(job, 'completed');
      this.release(slot);
      return;
    }

    if (message.type === 'canceled') {
      this.clearTimers(slot);
      this.finish(job, 'canceled', null);
      this.closeLane(job, 'canceled');
      this.release(slot);
      return;
    }

    this.clearTimers(slot);
    this.finish(job, 'failed', message.message || 'job failed');
    this.closeLane(job, 'failed');
    this.release(slot);
  }

  private onWorkerError(slot: Slot, generation: number, error: Error): void {
    if (this.closed || slot.generation !== generation) return;
    const job = slot.jobId ? this.jobs.get(slot.jobId) : undefined;
    if (job && job.state === 'running') {
      this.clearTimers(slot);
      this.finish(job, 'failed', error.message || 'worker crashed');
      this.closeLane(job, 'failed');
      slot.jobId = null;
    }
  }

  private onExit(slot: Slot, generation: number, code: number): void {
    if (this.closed || slot.generation !== generation) return;
    const job = slot.jobId ? this.jobs.get(slot.jobId) : undefined;
    if (job && job.state === 'running') {
      this.clearTimers(slot);
      this.finish(job, 'failed', `worker exited (${code})`);
      this.closeLane(job, 'failed');
    }
    this.clearTimers(slot);
    slot.worker?.removeAllListeners();
    slot.worker = null;
    slot.status = 'booting';
    slot.jobId = null;
    slot.flag = null;
    slot.jobType = null;
    slot.jobStartedAt = null;
    slot.bootFailures += 1;
    this.scheduleSpawn(slot);
  }

  private onTimeout(slot: Slot, jobId: string, generation: number): void {
    if (this.closed || slot.generation !== generation || slot.jobId !== jobId) return;
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'running') return;
    if (job.cancelRequested) {
      this.forceCancel(slot, jobId, generation);
      return;
    }
    this.finish(job, 'failed', 'timed out');
    this.closeLane(job, 'failed');
    this.replaceWorker(slot);
  }

  private forceCancel(slot: Slot, jobId: string, generation: number): void {
    if (this.closed || slot.generation !== generation || slot.jobId !== jobId) return;
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'running') return;
    this.finish(job, 'canceled', null);
    this.closeLane(job, 'canceled');
    this.replaceWorker(slot);
  }

  private replaceWorker(slot: Slot): void {
    this.clearTimers(slot);
    const previous = slot.worker;
    slot.generation = ++this.generationCounter;
    slot.worker = null;
    slot.status = 'booting';
    slot.jobId = null;
    slot.flag = null;
    slot.jobType = null;
    slot.jobStartedAt = null;
    previous?.removeAllListeners();
    void previous?.terminate();
    this.spawn(slot);
  }

  private pump(): void {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.status !== 'idle' || !slot.worker) continue;
      const job = this.queue.shift();
      if (!job) return;
      this.assign(slot, job);
    }
  }

  private assign(slot: Slot, job: JobView): void {
    const flag = createCancelFlag();
    const startedAt = this.now();
    slot.status = 'busy';
    slot.jobId = job.id;
    slot.jobType = job.type;
    slot.jobStartedAt = startedAt;
    slot.flag = flag;
    job.state = 'running';
    job.workerId = slot.id;
    job.startedAt = startedAt;
    this.lanes.push({
      workerId: slot.id,
      jobId: job.id,
      jobType: job.type,
      startedAt,
      endedAt: null,
      state: 'running',
      progress: job.progress,
    });
    this.trimLanes();

    const generation = slot.generation;
    slot.timeout = setTimeout(() => this.onTimeout(slot, job.id, generation), job.timeoutMs);
    try {
      slot.worker?.postMessage({
        type: 'start',
        jobId: job.id,
        jobType: job.type,
        params: job.params,
        cancelFlag: flag.buffer,
      });
    } catch (error) {
      this.clearTimers(slot);
      const message = error instanceof Error ? error.message : 'failed to start job';
      this.finish(job, 'failed', message);
      this.closeLane(job, 'failed');
      this.replaceWorker(slot);
      return;
    }
    this.emit(job);
  }

  private release(slot: Slot): void {
    slot.status = 'idle';
    slot.jobId = null;
    slot.flag = null;
    slot.jobType = null;
    slot.jobStartedAt = null;
    this.pump();
  }

  private applyProgress(job: JobView, percent: number, message?: string): void {
    if (!Number.isFinite(percent)) return;
    const next = Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
    if (next < job.progress) return;
    const messageChanged = message !== undefined && message !== job.message;
    if (next === job.progress && !messageChanged) return;
    job.progress = next;
    if (message !== undefined) job.message = message;
    this.emit(job);
  }

  private patchLane(job: JobView): void {
    for (let index = this.lanes.length - 1; index >= 0; index -= 1) {
      const lane = this.lanes[index];
      if (!lane || lane.jobId !== job.id || lane.endedAt !== null) continue;
      lane.progress = job.progress;
      return;
    }
  }

  private closeLane(job: JobView, state: LaneSegment['state']): void {
    for (let index = this.lanes.length - 1; index >= 0; index -= 1) {
      const lane = this.lanes[index];
      if (!lane || lane.jobId !== job.id || lane.endedAt !== null) continue;
      lane.endedAt = this.now();
      lane.state = state;
      lane.progress = job.progress;
      return;
    }
  }

  private trimLanes(): void {
    const cutoff = this.now() - 90_000;
    const recent = this.lanes.filter((lane) => (lane.endedAt ?? this.now()) >= cutoff);
    if (recent.length !== this.lanes.length) {
      this.lanes.length = 0;
      this.lanes.push(...recent.slice(-120));
      return;
    }
    if (this.lanes.length > 120) {
      this.lanes.splice(0, this.lanes.length - 120);
    }
  }

  private finish(job: JobView, state: Extract<JobState, 'completed' | 'failed' | 'canceled'>, error: string | null): void {
    if (isTerminal(job.state)) return;
    job.state = state;
    job.error = error;
    job.finishedAt = this.now();
    job.cancelRequested = false;
    if (state === 'completed') this.totals.completed += 1;
    else if (state === 'failed') this.totals.failed += 1;
    else this.totals.canceled += 1;
    this.emit(job);
  }

  private emit(job: JobView): void {
    const snapshot = cloneJob(job);
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private workerView(slot: Slot): WorkerView {
    return {
      id: slot.id,
      status: slot.status,
      jobId: slot.jobId,
      jobType: slot.jobType,
      startedAt: slot.jobStartedAt,
    };
  }

  private notifyReady(): void {
    if (this.slots.some((slot) => slot.status === 'booting')) return;
    const waiters = this.readyWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private clearTimers(slot: Slot): void {
    if (slot.timeout) clearTimeout(slot.timeout);
    if (slot.grace) clearTimeout(slot.grace);
    slot.timeout = undefined;
    slot.grace = undefined;
  }

  private clearSpawn(slot: Slot): void {
    if (slot.spawnTimer) clearTimeout(slot.spawnTimer);
    slot.spawnTimer = undefined;
  }

  private trim(): void {
    if (this.order.length <= this.maxJobs) return;
    const kept: string[] = [];
    let dropped = this.order.length - this.maxJobs;
    for (const id of this.order) {
      const job = this.jobs.get(id);
      if (dropped > 0 && job && isTerminal(job.state)) {
        this.jobs.delete(id);
        dropped -= 1;
        continue;
      }
      kept.push(id);
    }
    this.order.length = 0;
    this.order.push(...kept);
  }

  private stamp(): number {
    const time = this.now();
    this.lastStamp = Math.max(this.lastStamp + 1, time);
    return this.lastStamp;
  }

  private must(id: string): JobView {
    const job = this.jobs.get(id);
    if (!job) throw new JobNotFoundError(id);
    return job;
  }
}

function cloneJob(job: JobView): JobView {
  return { ...job, params: { ...job.params } };
}
