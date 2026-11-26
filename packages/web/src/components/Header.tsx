import type { LagView } from '@yard/shared';

export function Header({
  lag,
  connected,
  running,
}: {
  lag: LagView | undefined;
  connected: boolean;
  running: number;
}) {
  const value = lag?.lagMs ?? 0;
  const pct = Math.max(0, Math.min(100, (value / 80) * 100));
  const tone = value < 20 ? 'good' : value < 50 ? 'warn' : 'bad';
  const note =
    running > 0 && value < 25
      ? 'Workers are busy. This thread is not.'
      : 'Delay of a 100ms heartbeat on the main thread.';

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Dispatch board</p>
        <h1 className="wordmark">
          Y<span>A</span>RD
        </h1>
        <p className="lede">CPU work, off the main thread.</p>
      </div>
      <div className="lag">
        <div className="lag-label">
          <span>Main thread</span>
          <strong className={tone}>{lag ? `${value.toFixed(1)} ms` : '—'}</strong>
        </div>
        <div
          className="gauge"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={80}
          aria-valuenow={Math.round(value)}
          aria-label="Main thread event loop lag"
        >
          <span className="gauge-mark" style={{ left: `${pct}%` }} />
        </div>
        <p className="lag-note">{note}</p>
        <p className="lag-sub">{lag ? `p99 ${lag.p99Ms.toFixed(1)} ms` : 'waiting for a sample'}</p>
      </div>
      <p className={connected ? 'live' : 'live down'}>{connected ? 'Live' : 'Reconnecting'}</p>
    </header>
  );
}
