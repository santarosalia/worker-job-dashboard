import { MessageChannel, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Piscina } from 'piscina';
import type { JobState, JobView, LaneSegment, PoolCore, WorkerView } from '@yard/shared';
import { isTerminal } from '@yard/shared';
import { defaultPoolSize } from '../config';
import { createId } from '../ids';
import { createCancelFlag, requestCancel } from './cancel';
import { InvalidJobStateError, JobNotFoundError } from './errors';
import { readTaskResult, readWorkerNote, type JobTask, type TaskResult } from './task';

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

interface Dispatch {
  port: MessagePort;
  controller: AbortController;
  flag: Int32Array;
  timeout?: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
}

/**
 * Fixed-size pool on top of Piscina.
 * The main thread keeps the job record. Piscina runs one task per thread.
 * A SharedArrayBuffer flag stops a tight loop without discarding the thread;
 * AbortSignal is the backstop that tells Piscina to stop the worker.
 */
export class WorkerPool {
  private readonly size: number;
  private readonly jobTimeoutMs: number;
  private readonly cancelGraceMs: number;
  private readonly maxJobs: number;
  private readonly now: () => number;
  private readonly engine: Piscina<JobTask, TaskResult>;
  private readonly jobs = new Map<string, JobView>();
  private readonly order: string[] = [];
  private readonly queue: JobView[] = [];
  private readonly lanes: LaneSegment[] = [];
  private readonly dispatches = new Map<string, Dispatch>();
  private readonly listeners = new Set<(job: JobView) => void>();
  private readonly readyWaiters: Array<() => void> = [];
  private lastStamp = 0;
  private closed = false;
  private readonly totals = { submitted: 0, completed: 0, failed: 0, canceled: 0 };

  constructor(options: WorkerPoolOptions) {
    this.size = Math.max(1, options.size ?? defaultPoolSize());
    this.jobTimeoutMs = options.jobTimeoutMs ?? 30_000;
    this.cancelGraceMs = options.cancelGraceMs ?? 750;
    this.maxJobs = options.maxJobs ?? 500;
    this.now = options.now ?? Date.now;
    const filename = fileURLToPath(options.workerUrl);
    this.engine = new Piscina<JobTask, TaskResult>({
      filename,
      minThreads: this.size,
      maxThreads: this.size,
      idleTimeout: Infinity,
      concurrentTasksPerWorker: 1,
      execArgv: options.execArgv ?? (filename.endsWith('.ts') ? ['--import', 'tsx'] : []),
    });
    this.engine.on('error', () => {
      // Task failures reject run(). This listener only keeps a task-less
      // worker error from becoming an unhandled 'error' event.
    });
    this.engine.on('workerCreate', () => this.notifyReady());
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
    const dispatch = this.dispatches.get(id);
    if (dispatch) {
      requestCancel(dispatch.flag);
      if (dispatch.timeout) {
        clearTimeout(dispatch.timeout);
        dispatch.timeout = undefined;
      }
      if (!dispatch.grace) {
        dispatch.grace = setTimeout(() => this.forceCancel(id), this.cancelGraceMs);
      }
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
      running: [...this.jobs.values()].filter((job) => job.state === 'running').length,
      workers: this.workerViews(),
      lanes: this.lanes.map((lane) => ({ ...lane })),
      totals: { ...this.totals },
    };
  }

  subscribe(listener: (job: JobView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  whenReady(): Promise<void> {
    if (this.closed || this.threadsReady()) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.readyWaiters.splice(0)) waiter();
    for (const dispatch of this.dispatches.values()) {
      this.clearTimers(dispatch);
      this.closePort(dispatch);
    }
    this.dispatches.clear();
    this.listeners.clear();
    await this.engine.destroy();
  }

  private pump(): void {
    if (this.closed) return;
    while (this.dispatches.size < this.size) {
      const job = this.queue.shift();
      if (!job || isTerminal(job.state)) {
        if (!job) return;
        continue;
      }
      this.dispatch(job);
    }
  }

  private dispatch(job: JobView): void {
    const { flag, buffer } = createCancelFlag();
    const { port1, port2 } = new MessageChannel();
    const controller = new AbortController();
    const dispatch: Dispatch = { port: port1, controller, flag };
    this.dispatches.set(job.id, dispatch);

    job.state = 'running';
    job.startedAt = this.now();
    port1.on('message', (raw) => this.onNote(job.id, raw));
    dispatch.timeout = setTimeout(() => this.onTimeout(job.id), job.timeoutMs);
    this.emit(job);

    void this.engine
      .run(
        {
          jobType: job.type,
          params: job.params,
          port: port2,
          cancelFlag: buffer,
        },
        { transferList: [port2], signal: controller.signal },
      )
      .then(
        (outcome) => this.onSuccess(job.id, outcome),
        (error: unknown) => this.onFailure(job.id, error),
      );
  }

  private drain(port: MessagePort, jobId: string): void {
    let received = receiveMessageOnPort(port);
    while (received) {
      this.onNote(jobId, received.message);
      received = receiveMessageOnPort(port);
    }
  }

  private onNote(jobId: string, raw: unknown): void {
    if (this.closed) return;
    const job = this.jobs.get(jobId);
    const note = readWorkerNote(raw);
    if (!job || !note) return;
    if (note.type === 'start') {
      this.attachThread(job, note.threadId);
      return;
    }
    if (isTerminal(job.state)) return;
    this.applyProgress(job, note.percent, note.message);
    this.patchLane(job);
  }

  private onSuccess(jobId: string, outcome: TaskResult): void {
    if (this.closed) return;
    const job = this.jobs.get(jobId);
    const dispatch = this.dispatches.get(jobId);
    if (!job || !dispatch) return;
    // Progress and the piscina result travel on different ports. Drain anything
    // already queued so a fast task cannot complete before its own percents.
    this.drain(dispatch.port, jobId);
    const parsed = readTaskResult(outcome);
    if (parsed) this.attachThread(job, parsed.threadId);
    if (isTerminal(job.state)) {
      this.release(jobId);
      return;
    }
    if (!parsed) {
      this.finish(job, 'failed', 'invalid worker result');
      this.closeLane(job, 'failed');
    } else if (parsed.canceled) {
      this.finish(job, 'canceled', null);
      this.closeLane(job, 'canceled');
    } else {
      job.result = parsed.result ?? null;
      job.progress = 100;
      this.finish(job, 'completed', null);
      this.closeLane(job, 'completed');
    }
    this.release(jobId);
  }

  private onFailure(jobId: string, error: unknown): void {
    if (this.closed) return;
    const job = this.jobs.get(jobId);
    const dispatch = this.dispatches.get(jobId);
    if (!job || !dispatch) return;
    this.drain(dispatch.port, jobId);
    if (!isTerminal(job.state)) {
      const message = error instanceof Error ? error.message : 'job failed';
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted && job.cancelRequested) {
        this.finish(job, 'canceled', null);
        this.closeLane(job, 'canceled');
      } else if (aborted) {
        this.finish(job, 'failed', 'timed out');
        this.closeLane(job, 'failed');
      } else {
        this.finish(job, 'failed', message || 'job failed');
        this.closeLane(job, 'failed');
      }
    }
    this.release(jobId);
  }

  private onTimeout(jobId: string): void {
    const job = this.jobs.get(jobId);
    const dispatch = this.dispatches.get(jobId);
    if (this.closed || !job || !dispatch || job.state !== 'running') return;
    if (job.cancelRequested) {
      this.forceCancel(jobId);
      return;
    }
    this.finish(job, 'failed', 'timed out');
    this.closeLane(job, 'failed');
    this.drop(jobId, true);
  }

  private forceCancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    const dispatch = this.dispatches.get(jobId);
    if (this.closed || !job || !dispatch || job.state !== 'running') return;
    this.finish(job, 'canceled', null);
    this.closeLane(job, 'canceled');
    this.drop(jobId, true);
  }

  private drop(jobId: string, abort: boolean): void {
    const dispatch = this.dispatches.get(jobId);
    if (!dispatch) return;
    this.dispatches.delete(jobId);
    this.clearTimers(dispatch);
    if (abort) dispatch.controller.abort();
    this.closePort(dispatch);
    this.pump();
  }

  private release(jobId: string): void {
    this.drop(jobId, false);
  }

  private attachThread(job: JobView, threadId: number): void {
    if (!Number.isInteger(threadId) || threadId <= 0) return;
    const id = String(threadId);
    const known = job.workerId === id && this.laneIndex(job.id) >= 0;
    job.workerId = id;
    if (job.startedAt === null) job.startedAt = this.now();
    if (this.laneIndex(job.id) < 0) {
      this.lanes.push({
        workerId: id,
        jobId: job.id,
        jobType: job.type,
        startedAt: job.startedAt,
        endedAt: isTerminal(job.state) ? this.now() : null,
        state: isTerminal(job.state) ? terminalLane(job.state) : 'running',
        progress: job.progress,
      });
      this.trimLanes();
    }
    if (!known && !isTerminal(job.state)) this.emit(job);
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
    const index = this.laneIndex(job.id);
    const lane = index >= 0 ? this.lanes[index] : undefined;
    if (!lane || lane.endedAt !== null) return;
    lane.progress = job.progress;
  }

  private closeLane(job: JobView, state: LaneSegment['state']): void {
    const index = this.laneIndex(job.id);
    const lane = index >= 0 ? this.lanes[index] : undefined;
    if (!lane || lane.endedAt !== null) return;
    lane.endedAt = this.now();
    lane.state = state;
    lane.progress = job.progress;
  }

  private laneIndex(jobId: string): number {
    for (let index = this.lanes.length - 1; index >= 0; index -= 1) {
      const lane = this.lanes[index];
      if (lane?.jobId === jobId && lane.endedAt === null) return index;
    }
    return -1;
  }

  private trimLanes(): void {
    const cutoff = this.now() - 90_000;
    const recent = this.lanes.filter((lane) => (lane.endedAt ?? this.now()) >= cutoff);
    if (recent.length !== this.lanes.length) {
      this.lanes.length = 0;
      this.lanes.push(...recent.slice(-120));
      return;
    }
    if (this.lanes.length > 120) this.lanes.splice(0, this.lanes.length - 120);
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

  private workerViews(): WorkerView[] {
    const ids = this.engine.threads
      .map((thread) => thread.threadId)
      .filter((threadId) => threadId > 0)
      .sort((left, right) => left - right);
    return ids.map((threadId) => {
      const id = String(threadId);
      const job = [...this.jobs.values()].find((item) => item.state === 'running' && item.workerId === id);
      return {
        id,
        status: job ? 'busy' : 'idle',
        jobId: job?.id ?? null,
        jobType: job?.type ?? null,
        startedAt: job?.startedAt ?? null,
      };
    });
  }

  private threadsReady(): boolean {
    return this.engine.threads.filter((thread) => thread.threadId > 0).length >= this.size;
  }

  private notifyReady(): void {
    if (!this.threadsReady()) return;
    const waiters = this.readyWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private clearTimers(dispatch: Dispatch): void {
    if (dispatch.timeout) clearTimeout(dispatch.timeout);
    if (dispatch.grace) clearTimeout(dispatch.grace);
    dispatch.timeout = undefined;
    dispatch.grace = undefined;
  }

  private closePort(dispatch: Dispatch): void {
    dispatch.port.removeAllListeners();
    dispatch.port.close();
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

function terminalLane(state: JobState): LaneSegment['state'] {
  if (state === 'failed' || state === 'canceled' || state === 'completed') return state;
  return 'completed';
}
