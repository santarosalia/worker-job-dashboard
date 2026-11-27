import { afterEach, describe, expect, it } from 'vitest';
import { WorkerPool } from '../src/pool/worker-pool';
import { transitions, waitForJob, waitForProgress, workerUrl } from './helpers';

let pool: WorkerPool | undefined;

afterEach(async () => {
  await pool?.destroy();
  pool = undefined;
});

function createPool(size: number, extra: { jobTimeoutMs?: number; cancelGraceMs?: number } = {}) {
  pool = new WorkerPool({
    size,
    workerUrl,
    jobTimeoutMs: extra.jobTimeoutMs ?? 10_000,
    cancelGraceMs: extra.cancelGraceMs ?? 400,
  });
  return pool;
}

describe('WorkerPool', () => {
  it('moves a job queued -> running -> completed without blocking the main thread', async () => {
    const subject = createPool(1);
    await subject.whenReady();

    const seen: Array<'queued' | 'running' | 'completed' | 'failed' | 'canceled'> = [];
    let id = '';
    subject.subscribe((job) => {
      if (!id) id = job.id;
      if (job.id === id) seen.push(job.state);
    });

    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 10);

    subject.submit({ type: 'spin', params: { steps: 80, iters: 3_000_000, tag: 'solo' } });
    const done = await waitForJob(subject, id);
    clearInterval(timer);

    expect(transitions(seen)).toEqual(['queued', 'running', 'completed']);
    expect(done.result).toMatchObject({ tag: 'solo' });
    expect(done.progress).toBe(100);
    expect(done.workerId).toMatch(/^[1-9]\d*$/);
    expect(subject.stats().workers.map((worker) => worker.id)).toContain(done.workerId);
    const lane = subject.snapshot().lanes.find((item) => item.jobId === done.id);
    expect(lane?.workerId).toBe(done.workerId);
    expect(lane?.state).toBe('completed');
    expect(ticks).toBeGreaterThan(8);
  });

  it('never runs more jobs than the pool size and keeps FIFO order', async () => {
    const subject = createPool(2);
    await subject.whenReady();
    expect(subject.stats().workers).toHaveLength(2);
    expect(subject.stats().workers.every((worker) => /^[1-9]\d*$/.test(worker.id) && worker.status === 'idle')).toBe(true);

    let maxRunning = 0;
    const started: string[] = [];
    subject.subscribe((job) => {
      maxRunning = Math.max(maxRunning, subject.stats().running);
      if (job.state === 'running' && typeof job.params.tag === 'string' && !started.includes(job.params.tag)) {
        started.push(job.params.tag);
      }
    });

    const jobs = ['a', 'b', 'c', 'd'].map((tag) =>
      subject.submit({ type: 'spin', params: { steps: 8, iters: 900_000, tag } }),
    );

    const finished = await Promise.all(jobs.map((job) => waitForJob(subject, job.id)));
    expect(finished.every((job) => job.state === 'completed')).toBe(true);
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(maxRunning).toBe(2);
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    expect(subject.stats().queueDepth).toBe(0);
    expect(subject.stats().running).toBe(0);
  });

  it('cancels a queued job before it starts and still runs the one behind it', async () => {
    const subject = createPool(1);
    await subject.whenReady();

    const blocker = subject.submit({ type: 'spin', params: { steps: 16, iters: 800_000, tag: 'blocker' } });
    await waitForProgress(subject, blocker.id, 1);

    const skipped = subject.submit({ type: 'spin', params: { steps: 4, iters: 50_000, tag: 'skip' } });
    const follower = subject.submit({ type: 'spin', params: { steps: 3, iters: 40_000, tag: 'follow' } });
    expect(skipped.state).toBe('queued');

    const canceled = subject.cancel(skipped.id);
    expect(canceled.state).toBe('canceled');
    expect(canceled.startedAt).toBeNull();

    const blockerDone = await waitForJob(subject, blocker.id);
    const followerDone = await waitForJob(subject, follower.id);
    expect(blockerDone.state).toBe('completed');
    expect(followerDone.state).toBe('completed');
    expect(subject.get(skipped.id)?.state).toBe('canceled');
    expect(subject.get(skipped.id)?.startedAt).toBeNull();
    expect((followerDone.startedAt ?? 0) >= (blockerDone.finishedAt ?? 0)).toBe(true);
  });

  it('cancels a running job cooperatively and reuses the worker', async () => {
    const subject = createPool(1);
    await subject.whenReady();

    const job = subject.submit({ type: 'spin', params: { steps: 50, iters: 700_000, tag: 'stop-me' } });
    await waitForProgress(subject, job.id, 4);
    expect(subject.get(job.id)?.state).toBe('running');

    subject.cancel(job.id);
    const stopped = await waitForJob(subject, job.id);
    expect(stopped.state).toBe('canceled');
    expect(stopped.progress).toBeGreaterThan(0);
    expect(stopped.progress).toBeLessThan(100);

    const next = subject.submit({ type: 'spin', params: { steps: 2, iters: 20_000, tag: 'after' } });
    const done = await waitForJob(subject, next.id);
    expect(done.state).toBe('completed');
    expect(done.workerId).toBe(stopped.workerId);
    expect(subject.stats().workers.map((worker) => worker.id)).toEqual([stopped.workerId]);
  });

  it('fails a job that exceeds its timeout and respawns the worker for the next job', async () => {
    const subject = createPool(1, { jobTimeoutMs: 30_000 });
    await subject.whenReady();

    const hung = subject.submit({ type: 'ignore', params: { ms: 8_000 }, timeoutMs: 200 });
    const failed = await waitForJob(subject, hung.id, 5_000);
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/timed out/);
    expect(failed.workerId).toMatch(/^[1-9]\d*$/);

    const next = subject.submit({ type: 'spin', params: { steps: 2, iters: 30_000, tag: 'recovered' } });
    const done = await waitForJob(subject, next.id);
    expect(done.state).toBe('completed');
    expect(done.workerId).toMatch(/^[1-9]\d*$/);
    expect(done.workerId).not.toBe(failed.workerId);
    expect(subject.stats().workers).toHaveLength(1);
    expect(subject.stats().size).toBe(1);
  });

  it('marks a crashed job failed and respawns the worker', async () => {
    const subject = createPool(2);
    await subject.whenReady();

    const crashed = subject.submit({ type: 'crash', params: {} });
    const failed = await waitForJob(subject, crashed.id);
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/worker exited/i);

    const next = subject.submit({ type: 'spin', params: { steps: 2, iters: 20_000, tag: 'alive' } });
    const done = await waitForJob(subject, next.id);
    expect(done.state).toBe('completed');
    expect(subject.stats().size).toBe(2);
    expect(subject.stats().workers).toHaveLength(2);
  });

  it('ignores out-of-order progress so percents never decrease', async () => {
    const subject = createPool(1);
    await subject.whenReady();

    const seen: number[] = [];
    let id = '';
    subject.subscribe((job) => {
      if (!id) id = job.id;
      if (job.id === id) seen.push(job.progress);
    });

    subject.submit({ type: 'unordered', params: { seq: [10, 40, 15, 70, 70, 100] } });
    const done = await waitForJob(subject, id);
    expect(done.state).toBe('completed');
    expect(done.progress).toBe(100);

    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] ?? 0);
    }
    expect(seen).toContain(10);
    expect(seen).toContain(40);
    expect(seen).toContain(70);
    expect(seen).not.toContain(15);
  });

  it('retries a failed job as a new queued attempt and lists it', async () => {
    const subject = createPool(1);
    await subject.whenReady();

    const original = subject.submit({ type: 'crash', params: { limit: 3 } });
    const failed = await waitForJob(subject, original.id);
    expect(failed.state).toBe('failed');

    const retried = subject.retry(original.id);
    expect(retried.id).not.toBe(original.id);
    expect(retried.retryOf).toBe(original.id);
    expect(retried.attempt).toBe(2);
    expect(retried.params).toEqual({ limit: 3 });
    expect(['queued', 'running']).toContain(retried.state);

    const again = await waitForJob(subject, retried.id);
    expect(again.state).toBe('failed');

    const ids = subject.list().map((job) => job.id);
    expect(ids).toContain(original.id);
    expect(ids).toContain(retried.id);
    expect(subject.get(original.id)?.id).toBe(original.id);
    expect(subject.get('missing')).toBeUndefined();
    expect(() => subject.retry('job_missing')).toThrow(/not found/i);
  });

  it('refuses to retry a job that is not failed or canceled', async () => {
    const subject = createPool(1);
    await subject.whenReady();
    const job = subject.submit({ type: 'spin', params: { steps: 2, iters: 10_000 } });
    const done = await waitForJob(subject, job.id);
    expect(done.state).toBe('completed');
    expect(() => subject.retry(done.id)).toThrow(/cannot retry/i);
  });
});
