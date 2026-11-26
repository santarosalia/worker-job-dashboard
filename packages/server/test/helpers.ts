import type { JobState, JobView } from '@yard/shared';
import type { WorkerPool } from '../src/pool/worker-pool';

export const workerUrl = new URL('./fixtures/controllable-worker.ts', import.meta.url);

export function waitForJob(pool: WorkerPool, id: string, timeoutMs = 8_000): Promise<JobView> {
  const current = pool.get(id);
  if (current && isTerminal(current.state)) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`timed out waiting for ${id} (state=${pool.get(id)?.state ?? 'missing'})`));
    }, timeoutMs);

    const unsub = pool.subscribe((job) => {
      if (job.id !== id || !isTerminal(job.state)) return;
      clearTimeout(timer);
      unsub();
      resolve(job);
    });

    const again = pool.get(id);
    if (again && isTerminal(again.state)) {
      clearTimeout(timer);
      unsub();
      resolve(again);
    }
  });
}

export function waitForProgress(
  pool: WorkerPool,
  id: string,
  min: number,
  timeoutMs = 8_000,
): Promise<JobView> {
  const current = pool.get(id);
  if (current && current.progress >= min) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`timed out waiting for ${id} progress >= ${min} (progress=${pool.get(id)?.progress ?? 'missing'})`));
    }, timeoutMs);

    const unsub = pool.subscribe((job) => {
      if (job.id !== id || job.progress < min) return;
      clearTimeout(timer);
      unsub();
      resolve(job);
    });
  });
}

export function transitions(states: JobState[]): JobState[] {
  return states.filter((state, index) => index === 0 || state !== states[index - 1]);
}

function isTerminal(state: JobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled';
}
