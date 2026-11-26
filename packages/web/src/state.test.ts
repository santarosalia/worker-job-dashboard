import { describe, expect, it } from 'vitest';
import type { JobView, PoolView, Snapshot } from '@yard/shared';
import { applyBatch, applySnapshot, emptyState, mergeJob } from './state';

function job(partial: Partial<JobView> & Pick<JobView, 'id' | 'state' | 'progress'>): JobView {
  return {
    type: 'prime',
    params: { limit: 1000 },
    message: null,
    result: null,
    error: null,
    timeoutMs: 1000,
    workerId: null,
    attempt: 1,
    retryOf: null,
    cancelRequested: false,
    createdAt: 10,
    startedAt: null,
    finishedAt: null,
    ...partial,
  };
}

const pool = { size: 1, queueDepth: 0, running: 0, workers: [], lanes: [], totals: { submitted: 0, completed: 0, failed: 0, canceled: 0 }, series: [], lag: { lagMs: 1, meanMs: 1, p99Ms: 1, maxMs: 1 } } satisfies PoolView;

describe('dashboard state', () => {
  it('keeps progress monotonic and refuses to rewind a terminal job', () => {
    const running = job({ id: 'a', state: 'running', progress: 40, createdAt: 2 });
    expect(mergeJob(running, job({ id: 'a', state: 'running', progress: 15, createdAt: 2 })).progress).toBe(40);
    const completed = mergeJob(running, job({ id: 'a', state: 'completed', progress: 100, createdAt: 2, finishedAt: 9 }));
    expect(completed.state).toBe('completed');
    expect(mergeJob(completed, job({ id: 'a', state: 'running', progress: 80, createdAt: 2 }))).toBe(completed);
  });

  it('pins a running job above a newer queued job', () => {
    const state = applyBatch(emptyState(), {
      now: Date.now(),
      jobs: [
        job({ id: 'wait', state: 'queued', progress: 0, createdAt: 50 }),
        job({ id: 'go', state: 'running', progress: 12, createdAt: 1 }),
      ],
    });
    expect(state.jobs.map((item) => item.id)).toEqual(['go', 'wait']);
  });

  it('sorts newer jobs first and replaces the pool snapshot', () => {
    const state = applyBatch(emptyState(), {
      now: Date.now(),
      jobs: [job({ id: 'old', state: 'queued', progress: 0, createdAt: 1 }), job({ id: 'new', state: 'queued', progress: 0, createdAt: 5 })],
    });
    expect(state.jobs.map((item) => item.id)).toEqual(['new', 'old']);

    const next = applyBatch(state, { now: Date.now(), pool: { ...pool, queueDepth: 4 } });
    expect(next.pool?.queueDepth).toBe(4);
    expect(next.jobs).toHaveLength(2);
  });

  it('merges a late snapshot without moving progress backwards', () => {
    const started = applyBatch(emptyState(), {
      now: 1_000,
      jobs: [job({ id: 'a', state: 'running', progress: 50, createdAt: 1 })],
    });
    const snapshot: Snapshot = {
      now: 1_100,
      jobs: [job({ id: 'a', state: 'running', progress: 20, createdAt: 1 }), job({ id: 'b', state: 'queued', progress: 0, createdAt: 2 })],
      pool,
    };
    const merged = applySnapshot(started, snapshot);
    expect(merged.jobs.find((item) => item.id === 'a')?.progress).toBe(50);
    expect(merged.jobs.map((item) => item.id).sort()).toEqual(['a', 'b']);
    expect(merged.connected).toBe(true);
  });
});
