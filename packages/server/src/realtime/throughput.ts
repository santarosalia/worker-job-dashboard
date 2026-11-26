import type { ThroughputSample } from '@yard/shared';

export interface SampleTotals {
  completed: number;
  failed: number;
  canceled: number;
}

export function nextSample(
  previous: SampleTotals,
  totals: SampleTotals,
  point: { queueDepth: number; running: number; now: number },
): { sample: ThroughputSample; totals: SampleTotals } {
  return {
    sample: {
      t: point.now,
      queueDepth: point.queueDepth,
      running: point.running,
      completed: totals.completed - previous.completed,
      failed: totals.failed - previous.failed,
      canceled: totals.canceled - previous.canceled,
    },
    totals: { ...totals },
  };
}
