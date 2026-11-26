import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { LagView } from '@yard/shared';

/** Heartbeat drift plus a perf_hooks histogram. Both stay on the main thread on purpose. */
export class EventLoopMonitor {
  private readonly histogram: IntervalHistogram;
  private timer: ReturnType<typeof setInterval> | null = null;
  private expected = 0;
  private lagMs = 0;

  constructor(private readonly intervalMs = 100) {
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
  }

  start(): void {
    this.histogram.enable();
    this.expected = Date.now() + this.intervalMs;
    this.timer = setInterval(() => {
      const now = Date.now();
      this.lagMs = Math.max(0, now - this.expected);
      this.expected = now + this.intervalMs;
    }, this.intervalMs);
  }

  snapshot(): LagView {
    const view: LagView = {
      lagMs: round(this.lagMs),
      meanMs: round(nsToMs(this.histogram.mean)),
      p99Ms: round(nsToMs(this.histogram.percentile(99))),
      maxMs: round(nsToMs(this.histogram.max)),
    };
    this.histogram.reset();
    return view;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.histogram.disable();
  }
}

function nsToMs(value: number): number {
  return Number.isFinite(value) ? value / 1e6 : 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
