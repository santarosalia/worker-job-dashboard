import { describe, expect, it } from 'vitest';
import type { JobView, LiveBatch, PoolView } from '@yard/shared';
import { EventHub, type Scheduler } from '../src/realtime/hub';

class ManualScheduler implements Scheduler {
  calls = 0;
  fn: (() => void) | null = null;

  schedule(fn: () => void): { cancel: () => void } {
    this.calls += 1;
    this.fn = fn;
    return {
      cancel: () => {
        if (this.fn === fn) this.fn = null;
      },
    };
  }

  flush(): void {
    const fn = this.fn;
    this.fn = null;
    fn?.();
  }
}

function job(partial: Partial<JobView> & Pick<JobView, 'id'>): JobView {
  return {
    type: 'prime',
    params: { limit: 1000 },
    state: 'running',
    progress: 0,
    message: null,
    result: null,
    error: null,
    timeoutMs: 1000,
    workerId: 'w1',
    attempt: 1,
    retryOf: null,
    cancelRequested: false,
    createdAt: 1,
    startedAt: 1,
    finishedAt: null,
    ...partial,
  };
}

function pool(queueDepth: number): PoolView {
  return {
    size: 2,
    queueDepth,
    running: 0,
    workers: [],
    lanes: [],
    totals: { submitted: 0, completed: 0, failed: 0, canceled: 0 },
    series: [],
    lag: { lagMs: 0, meanMs: 0, p99Ms: 0, maxMs: 0 },
  };
}

describe('EventHub', () => {
  it('coalesces progress for each job into the latest value on one flush', () => {
    const scheduler = new ManualScheduler();
    const hub = new EventHub({ intervalMs: 100, scheduler, now: () => 50 });
    const batches: LiveBatch[] = [];
    hub.subscribe((batch) => batches.push(batch));

    hub.publishJob(job({ id: 'a', progress: 10 }));
    hub.publishJob(job({ id: 'a', progress: 40, message: 'later' }));
    hub.publishJob(job({ id: 'b', progress: 5 }));

    expect(scheduler.calls).toBe(1);
    expect(batches).toHaveLength(0);

    scheduler.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.now).toBe(50);
    const jobs = batches[0]?.jobs ?? [];
    expect(jobs.map((item) => item.id).sort()).toEqual(['a', 'b']);
    expect(jobs.find((item) => item.id === 'a')).toMatchObject({ progress: 40, message: 'later' });
  });

  it('does not push the flush deadline back while progress keeps arriving', () => {
    const scheduler = new ManualScheduler();
    const hub = new EventHub({ intervalMs: 100, scheduler });
    hub.publishJob(job({ id: 'a', progress: 10 }));
    hub.publishJob(job({ id: 'a', progress: 20 }));
    hub.publishJob(job({ id: 'a', progress: 30 }));
    expect(scheduler.calls).toBe(1);
  });

  it('flushes immediately on terminal updates and includes progress already buffered', () => {
    const scheduler = new ManualScheduler();
    const hub = new EventHub({ intervalMs: 100, scheduler, now: () => 9 });
    const batches: LiveBatch[] = [];
    hub.subscribe((batch) => batches.push(batch));

    hub.publishJob(job({ id: 'a', progress: 12 }));
    expect(scheduler.calls).toBe(1);

    hub.publishJob(job({ id: 'b', state: 'completed', progress: 100, finishedAt: 9 }), true);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.jobs?.map((item) => item.id).sort()).toEqual(['a', 'b']);
    expect(scheduler.fn).toBeNull();
  });

  it('keeps only the latest pool snapshot in the pending batch', () => {
    const scheduler = new ManualScheduler();
    const hub = new EventHub({ intervalMs: 100, scheduler });
    const batches: LiveBatch[] = [];
    hub.subscribe((batch) => batches.push(batch));

    hub.publishPool(pool(3));
    hub.publishPool(pool(8));
    expect(batches).toHaveLength(0);
    scheduler.flush();
    expect(batches[0]?.pool?.queueDepth).toBe(8);
    hub.close();
  });
});
