import type { ThroughputSample } from '@yard/shared';

export function ThroughputChart({ series }: { series: ThroughputSample[] }) {
  const width = 640;
  const height = 148;
  const padX = 10;
  const padY = 18;
  const ready = series.length >= 2;
  const maxQueue = ready ? Math.max(1, ...series.map((sample) => sample.queueDepth)) : 1;
  const maxRate = ready ? Math.max(1, ...series.map((sample) => sample.completed)) : 1;
  const x = (index: number) => padX + (index / Math.max(1, series.length - 1)) * (width - padX * 2);
  const yOf = (value: number, max: number) => height - padY - (value / max) * (height - padY * 2);
  const area = ready
    ? `M ${x(0)} ${height - padY} ${series.map((sample, index) => `L ${x(index)} ${yOf(sample.queueDepth, maxQueue)}`).join(' ')} L ${x(series.length - 1)} ${height - padY} Z`
    : '';
  const line = ready ? series.map((sample, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${yOf(sample.completed, maxRate)}`).join(' ') : '';

  return (
    <section className="panel chart">
      <header className="panel-head split">
        <div>
          <h2>Queue and throughput</h2>
          <p>One sample a second. Depth on the fill, completions on the line.</p>
        </div>
        <div className="legend">
          <span><i className="swatch queue" /> queue {ready ? maxQueue : '—'}</span>
          <span><i className="swatch rate" /> /s {ready ? maxRate : '—'}</span>
        </div>
      </header>
      {ready ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Queue depth and completions per second">
          <path d={area} className="area" />
          <path d={line} className="rate-line" />
        </svg>
      ) : (
        <p className="empty">A point lands every second once jobs are moving.</p>
      )}
    </section>
  );
}
