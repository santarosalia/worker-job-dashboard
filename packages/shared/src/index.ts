export const JOB_TYPES = ['prime', 'sort', 'blur', 'montecarlo'] as const;

export type JobType = (typeof JOB_TYPES)[number];

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export type PresetName = 'short' | 'yard' | 'long';

export interface PrimeParams {
  limit: number;
}

export interface SortParams {
  length: number;
  seed: number;
}

export interface BlurParams {
  size: number;
  passes: number;
  hashRounds: number;
}

export interface MonteCarloParams {
  samples: number;
  seed: number;
}

export type JobParams = PrimeParams | SortParams | BlurParams | MonteCarloParams;

export interface PrimeResult {
  count: number;
  limit: number;
}

export interface SortResult {
  length: number;
  checksum: number;
  head: number;
  tail: number;
}

export interface BlurResult {
  size: number;
  passes: number;
  hashRounds: number;
  digest: string;
}

export interface MonteCarloResult {
  samples: number;
  inside: number;
  pi: number;
}

export interface JobView {
  id: string;
  type: string;
  params: Record<string, unknown>;
  state: JobState;
  progress: number;
  message: string | null;
  result: unknown;
  error: string | null;
  timeoutMs: number;
  workerId: string | null;
  attempt: number;
  retryOf: string | null;
  cancelRequested: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface WorkerView {
  id: string;
  status: 'booting' | 'idle' | 'busy';
  jobId: string | null;
  jobType: string | null;
  startedAt: number | null;
}

export interface LaneSegment {
  workerId: string;
  jobId: string;
  jobType: string;
  startedAt: number;
  endedAt: number | null;
  state: 'running' | 'completed' | 'failed' | 'canceled';
  progress: number;
}

export interface ThroughputSample {
  t: number;
  queueDepth: number;
  running: number;
  completed: number;
  failed: number;
  canceled: number;
}

export interface LagView {
  lagMs: number;
  meanMs: number;
  p99Ms: number;
  maxMs: number;
}

export interface PoolTotals {
  submitted: number;
  completed: number;
  failed: number;
  canceled: number;
}

export interface PoolCore {
  size: number;
  queueDepth: number;
  running: number;
  workers: WorkerView[];
  lanes: LaneSegment[];
  totals: PoolTotals;
}

export interface PoolView extends PoolCore {
  series: ThroughputSample[];
  lag: LagView;
}

export interface Snapshot {
  jobs: JobView[];
  pool: PoolView;
  now: number;
}

export interface LiveBatch {
  jobs?: JobView[];
  pool?: PoolView;
  now: number;
}

export const PARAM_LIMITS = {
  prime: { limit: { min: 1_000, max: 400_000_000 } },
  sort: {
    length: { min: 1_000, max: 8_000_000 },
    seed: { min: 1, max: 1_000_000_000 },
  },
  blur: {
    size: { min: 16, max: 1_024 },
    passes: { min: 1, max: 30 },
    hashRounds: { min: 1_000, max: 2_000_000 },
  },
  montecarlo: {
    samples: { min: 100_000, max: 200_000_000 },
    seed: { min: 1, max: 1_000_000_000 },
  },
  timeoutMs: { min: 50, max: 600_000 },
  bulk: { min: 1, max: 200 },
} as const;

export const DEFAULT_TIMEOUT_MS = 30_000;

export const PRESETS = {
  prime: {
    short: { limit: 60_000_000 },
    yard: { limit: 280_000_000 },
    long: { limit: 400_000_000 },
  },
  sort: {
    short: { length: 1_500_000, seed: 1 },
    yard: { length: 5_000_000, seed: 1 },
    long: { length: 8_000_000, seed: 1 },
  },
  blur: {
    short: { size: 256, passes: 4, hashRounds: 80_000 },
    yard: { size: 512, passes: 6, hashRounds: 900_000 },
    long: { size: 640, passes: 8, hashRounds: 1_600_000 },
  },
  montecarlo: {
    short: { samples: 12_000_000, seed: 1 },
    yard: { samples: 70_000_000, seed: 1 },
    long: { samples: 140_000_000, seed: 1 },
  },
} as const;

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

export function isTerminal(state: JobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled';
}
