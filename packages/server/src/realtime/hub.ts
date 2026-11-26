import type { JobView, LiveBatch, PoolView } from '@yard/shared';

export interface Scheduler {
  schedule(fn: () => void, ms: number): { cancel: () => void };
}

const defaultScheduler: Scheduler = {
  schedule(fn, ms) {
    const timer = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(timer) };
  },
};

/**
 * Coalesces progress by job id and flushes on a fixed delay.
 * New progress does not postpone the deadline, so a chatty job cannot stall the stream.
 * Terminal updates flush immediately and take any buffered progress with them.
 */
export class EventHub {
  private readonly intervalMs: number;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private readonly jobs = new Map<string, JobView>();
  private readonly subs = new Set<(batch: LiveBatch) => void>();
  private pool: PoolView | null = null;
  private pending: { cancel: () => void } | null = null;

  constructor(options: { intervalMs?: number; scheduler?: Scheduler; now?: () => number } = {}) {
    this.intervalMs = options.intervalMs ?? 100;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.now = options.now ?? Date.now;
  }

  subscribe(listener: (batch: LiveBatch) => void): () => void {
    this.subs.add(listener);
    return () => this.subs.delete(listener);
  }

  publishJob(job: JobView, immediate = false): void {
    this.jobs.set(job.id, job);
    if (immediate) this.flush();
    else this.arm();
  }

  publishPool(pool: PoolView, immediate = false): void {
    this.pool = pool;
    if (immediate) this.flush();
    else this.arm();
  }

  close(): void {
    this.pending?.cancel();
    this.pending = null;
    this.jobs.clear();
    this.pool = null;
    this.subs.clear();
  }

  private arm(): void {
    if (this.pending) return;
    this.pending = this.scheduler.schedule(() => {
      this.pending = null;
      this.flush();
    }, this.intervalMs);
  }

  private flush(): void {
    if (this.pending) {
      this.pending.cancel();
      this.pending = null;
    }
    if (this.jobs.size === 0 && !this.pool) return;

    const batch: LiveBatch = { now: this.now() };
    if (this.jobs.size > 0) {
      batch.jobs = [...this.jobs.values()];
      this.jobs.clear();
    }
    if (this.pool) {
      batch.pool = this.pool;
      this.pool = null;
    }
    for (const listener of [...this.subs]) listener(batch);
  }
}
