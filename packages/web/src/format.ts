import { JOB_TYPES, type JobType, type JobView } from '@yard/shared';

export const TYPE_META: Record<JobType, { label: string; detail: string; color: string }> = {
  prime: { label: 'Primes', detail: 'Count primes up to a limit', color: 'var(--amber)' },
  sort: { label: 'Sort', detail: 'Fill and mergesort a large array', color: 'var(--steel)' },
  blur: { label: 'Blur hash', detail: 'Box-blur a matrix, then hash it', color: 'var(--aqua)' },
  montecarlo: { label: 'Monte Carlo', detail: 'Estimate π from random points', color: 'var(--copper)' },
};

export function isKnownType(type: string): type is JobType {
  return (JOB_TYPES as readonly string[]).includes(type);
}

export function typeColor(type: string): string {
  return isKnownType(type) ? TYPE_META[type].color : 'var(--muted)';
}

export function formatResult(job: JobView): string | null {
  if (job.state !== 'completed' || !job.result || typeof job.result !== 'object') return null;
  const result = job.result as Record<string, unknown>;
  if (job.type === 'prime' && typeof result.count === 'number') return `${result.count.toLocaleString('en-US')} primes`;
  if (job.type === 'sort' && typeof result.checksum === 'number') return `checksum ${result.checksum.toString(16)}`;
  if (job.type === 'blur' && typeof result.digest === 'string') return result.digest.slice(0, 12);
  if (job.type === 'montecarlo' && typeof result.pi === 'number') return `π ≈ ${result.pi.toFixed(5)}`;
  return null;
}

export function formatDuration(job: JobView, now: number): string {
  if (!job.startedAt) return '—';
  const end = job.finishedAt ?? now;
  return `${(Math.max(0, end - job.startedAt) / 1000).toFixed(1)}s`;
}

export function formatParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key} ${typeof value === 'number' ? value.toLocaleString('en-US') : String(value)}`)
    .join(' · ');
}

export function shortId(id: string): string {
  return id.replace(/^job_/, '');
}
