import type { PoolView, Snapshot } from '@yard/shared';
import { EventLoopMonitor } from './realtime/event-loop';
import { EventHub } from './realtime/hub';
import { nextSample, type SampleTotals } from './realtime/throughput';
import type { WorkerPool } from './pool/worker-pool';

export class Runtime {
  private readonly series: PoolView['series'] = [];
  private lastTotals: SampleTotals = { completed: 0, failed: 0, canceled: 0 };
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly pool: WorkerPool,
    private readonly lag: EventLoopMonitor,
    private readonly hub: EventHub,
  ) {}

  start(): void {
    this.lag.start();
    this.lastTotals = pick(this.pool.snapshot().totals);
    this.unsubscribe = this.pool.subscribe((job) => {
      const immediate = job.state !== 'running' || job.progress === 0;
      this.hub.publishJob(job, immediate);
    });
    this.timers.push(setInterval(() => this.hub.publishPool(this.poolView()), 250));
    this.timers.push(setInterval(() => this.sample(), 1_000));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.lag.stop();
    this.hub.close();
  }

  poolView(): PoolView {
    const core = this.pool.snapshot();
    return {
      ...core,
      series: this.series.map((sample) => ({ ...sample })),
      lag: this.lag.snapshot(),
    };
  }

  snapshot(): Snapshot {
    return {
      jobs: this.pool.list(200),
      pool: this.poolView(),
      now: Date.now(),
    };
  }

  private sample(): void {
    const core = this.pool.snapshot();
    const { sample, totals } = nextSample(this.lastTotals, core.totals, {
      queueDepth: core.queueDepth,
      running: core.running,
      now: Date.now(),
    });
    this.lastTotals = totals;
    this.series.push(sample);
    if (this.series.length > 60) this.series.shift();
  }
}

function pick(totals: { completed: number; failed: number; canceled: number }): SampleTotals {
  return { completed: totals.completed, failed: totals.failed, canceled: totals.canceled };
}
