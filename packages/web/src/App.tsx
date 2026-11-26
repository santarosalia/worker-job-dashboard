import { Header } from './components/Header';
import { JobTable } from './components/JobTable';
import { SubmitPanel } from './components/SubmitPanel';
import { ThroughputChart } from './components/ThroughputChart';
import { WorkerYard } from './components/WorkerYard';
import { useClock, useLive } from './useLive';

export function App() {
  const live = useLive();
  const now = useClock(live.offset);

  return (
    <div className="app">
      <Header lag={live.pool?.lag} connected={live.connected} running={live.pool?.running ?? 0} />
      <main className="layout">
        <SubmitPanel onJobs={live.merge} />
        <div className="stack">
          <WorkerYard pool={live.pool} jobs={live.jobs} now={now} />
          <ThroughputChart series={live.pool?.series ?? []} />
          <JobTable jobs={live.jobs} now={now} onJobs={live.merge} />
        </div>
      </main>
    </div>
  );
}
