import type { JobView, LaneSegment, PoolView } from '@yard/shared';
import { typeColor } from '../format';

export function WorkerYard({ pool, jobs, now }: { pool: PoolView | null; jobs: JobView[]; now: number }) {
  const queued = jobs.filter((job) => job.state === 'queued');
  const visible = queued.slice(0, 12);

  return (
    <section className="panel yard">
      <header className="panel-head split">
        <div>
          <h2>Worker tracks</h2>
          <p>Each rail is one thread. The car is the job on it, filled as it reports progress.</p>
        </div>
        <dl className="counters">
          <div>
            <dt>Queue</dt>
            <dd>{pool?.queueDepth ?? '—'}</dd>
          </div>
          <div>
            <dt>Running</dt>
            <dd>{pool?.running ?? '—'}</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>{pool?.totals.completed ?? '—'}</dd>
          </div>
        </dl>
      </header>

      {pool ? (
        <>
          <div className="siding" aria-label="Queued jobs">
            <span className="siding-label">Siding</span>
            {visible.length === 0 ? <span className="siding-empty">nothing waiting</span> : null}
            {visible.map((job) => (
              <span key={job.id} className="ticket" style={{ borderColor: typeColor(job.type) }}>
                {job.type}
              </span>
            ))}
            {queued.length > visible.length ? <span className="ticket more">+{queued.length - visible.length}</span> : null}
          </div>
          <div className="lanes">
            {pool.workers.map((worker) => {
              const windowMs = chooseWindow(now, pool.lanes);
              return (
                <div className="lane" key={worker.id}>
                  <div className="lane-name">
                    <strong>{worker.id.toUpperCase()}</strong>
                    <span>{worker.status === 'busy' && worker.jobType ? worker.jobType : 'idle'}</span>
                  </div>
                  <div className="track">
                    <div className="groove" />
                    {pool.lanes
                      .filter((lane) => lane.workerId === worker.id)
                      .map((lane) => {
                        const placed = place(lane.startedAt, lane.endedAt ?? now, now, windowMs);
                        if (!placed) return null;
                        return (
                          <div
                            key={`${lane.jobId}-${lane.startedAt}`}
                            className={`car ${lane.state}`}
                            style={{ left: `${placed.left}%`, width: `${placed.width}%`, background: typeColor(lane.jobType) }}
                            title={`${lane.jobType} ${lane.jobId} ${lane.state}`}
                          >
                            <span className="car-fill" style={{ width: `${Math.max(0, Math.min(100, lane.progress))}%` }} />
                            {placed.width >= 8 ? <span className="car-label">{lane.jobType}</span> : null}
                          </div>
                        );
                      })}
                    <div className="playhead" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="axis">
            last {Math.round(chooseWindow(now, pool.lanes) / 1000)}s <span>now</span>
          </p>
        </>
      ) : (
        <p className="empty">Connecting to the runner…</p>
      )}
    </section>
  );
}

function chooseWindow(now: number, lanes: LaneSegment[]): number {
  if (lanes.length === 0) return 12_000;
  const earliest = Math.min(...lanes.map((lane) => lane.startedAt));
  const latest = Math.max(...lanes.map((lane) => lane.endedAt ?? now));
  const span = Math.max(latest, now) - earliest;
  return Math.min(45_000, Math.max(12_000, span + 1_500));
}

function place(start: number, end: number, now: number, windowMs: number): { left: number; width: number } | null {
  const windowStart = now - windowMs;
  const left = ((start - windowStart) / windowMs) * 100;
  const right = ((end - windowStart) / windowMs) * 100;
  const clampedLeft = Math.max(0, left);
  const clampedRight = Math.min(100, right);
  if (clampedRight <= 0 || clampedLeft >= 100) return null;
  return { left: clampedLeft, width: Math.max(0.8, clampedRight - clampedLeft) };
}
