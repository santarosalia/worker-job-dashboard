import type { JobState, JobView, LiveBatch, PoolView, Snapshot } from '@yard/shared';

export interface DashboardState {
  jobs: JobView[];
  pool: PoolView | null;
  connected: boolean;
  offset: number;
}

const RANK: Record<JobState, number> = {
  queued: 0,
  running: 1,
  completed: 2,
  failed: 2,
  canceled: 2,
};

const ATTENTION: Record<JobState, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  canceled: 3,
  completed: 4,
};

export function emptyState(): DashboardState {
  return { jobs: [], pool: null, connected: false, offset: 0 };
}

export function applySnapshot(state: DashboardState, snapshot: Snapshot): DashboardState {
  return applyBatch(
    { ...state, jobs: state.jobs.length === 0 ? [] : state.jobs, connected: true },
    { jobs: snapshot.jobs, pool: snapshot.pool, now: snapshot.now },
  );
}

export function applyBatch(state: DashboardState, batch: LiveBatch): DashboardState {
  const byId = new Map(state.jobs.map((job) => [job.id, job]));
  for (const job of batch.jobs ?? []) {
    byId.set(job.id, mergeJob(byId.get(job.id), job));
  }
  const jobs = [...byId.values()].sort(
    (a, b) => ATTENTION[a.state] - ATTENTION[b.state] || b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  );
  return {
    jobs,
    pool: batch.pool ?? state.pool,
    connected: true,
    offset: batch.now - Date.now(),
  };
}

export function mergeJob(previous: JobView | undefined, next: JobView): JobView {
  if (!previous) return next;
  if (RANK[next.state] < RANK[previous.state]) return previous;
  if (next.state === previous.state && next.progress < previous.progress) return previous;
  return next;
}
