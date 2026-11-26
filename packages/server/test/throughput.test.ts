import { describe, expect, it } from 'vitest';
import { nextSample, type SampleTotals } from '../src/realtime/throughput';

describe('nextSample', () => {
  it('records per-interval deltas rather than cumulative totals', () => {
    const previous: SampleTotals = { completed: 4, failed: 1, canceled: 0 };
    const { sample, totals } = nextSample(
      previous,
      { completed: 7, failed: 1, canceled: 2 },
      { queueDepth: 12, running: 3, now: 1_700_000_000_000 },
    );

    expect(sample).toEqual({
      t: 1_700_000_000_000,
      queueDepth: 12,
      running: 3,
      completed: 3,
      failed: 0,
      canceled: 2,
    });
    expect(totals).toEqual({ completed: 7, failed: 1, canceled: 2 });
    expect(previous).toEqual({ completed: 4, failed: 1, canceled: 0 });
  });
});
