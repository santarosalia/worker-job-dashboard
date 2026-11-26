import { useState } from 'react';
import type { JobView } from '@yard/shared';
import { cancelJob, retryJob } from '../api';
import { formatDuration, formatParams, formatResult, shortId, typeColor } from '../format';

type Filter = 'all' | 'active' | 'done' | 'failed';

export function JobTable({
  jobs,
  now,
  onJobs,
}: {
  jobs: JobView[];
  now: number;
  onJobs: (jobs: JobView[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const counts = {
    all: jobs.length,
    active: jobs.filter((job) => job.state === 'queued' || job.state === 'running').length,
    done: jobs.filter((job) => job.state === 'completed' || job.state === 'canceled').length,
    failed: jobs.filter((job) => job.state === 'failed').length,
  };
  const visible = jobs.filter((job) => matches(filter, job)).slice(0, 60);

  async function act(kind: 'cancel' | 'retry', job: JobView) {
    setError(null);
    setPending(job.id);
    try {
      const next = kind === 'cancel' ? await cancelJob(job.id) : await retryJob(job.id);
      onJobs([next]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel jobs">
      <header className="panel-head split">
        <div>
          <h2>Jobs</h2>
          <p>Running jobs stay on top. Cancel stops a queued or running job. Retry starts a new attempt.</p>
        </div>
        <div className="filters" role="tablist" aria-label="Filter jobs">
          {(['all', 'active', 'done', 'failed'] as const).map((item) => (
            <button key={item} type="button" className={filter === item ? 'chip on' : 'chip'} onClick={() => setFilter(item)}>
              {item} {counts[item]}
            </button>
          ))}
        </div>
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="empty">The yard is empty. Run a job to put the workers to work.</p>
      ) : (
        <div className="job-list">
          {visible.map((job) => {
            const result = formatResult(job);
            const detail = job.error ?? job.message ?? result ?? formatParams(job.params);
            return (
              <article key={job.id} className="job">
                <div className="job-id">
                  <span className="dot" style={{ background: typeColor(job.type) }} />
                  <code>{shortId(job.id)}</code>
                  <small>{job.type}</small>
                </div>
                <div className={`state ${job.state}`}>{job.cancelRequested && job.state === 'running' ? 'canceling' : job.state}</div>
                <div className="job-progress">
                  <div
                    className="bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(job.progress)}
                    aria-label={`${job.type} progress`}
                  >
                    <span style={{ width: `${job.progress}%`, background: typeColor(job.type) }} />
                  </div>
                  <p>{detail}</p>
                </div>
                <div className="job-meta">
                  <span>{job.workerId ?? '—'}</span>
                  <span>{formatDuration(job, now)}</span>
                </div>
                <div className="job-actions">
                  {job.state === 'queued' || job.state === 'running' ? (
                    <button type="button" className="btn danger" disabled={pending === job.id} onClick={() => void act('cancel', job)}>
                      Cancel
                    </button>
                  ) : null}
                  {job.state === 'failed' || job.state === 'canceled' ? (
                    <button type="button" className="btn ghost" disabled={pending === job.id} onClick={() => void act('retry', job)}>
                      Retry
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function matches(filter: Filter, job: JobView): boolean {
  if (filter === 'active') return job.state === 'queued' || job.state === 'running';
  if (filter === 'done') return job.state === 'completed' || job.state === 'canceled';
  if (filter === 'failed') return job.state === 'failed';
  return true;
}
