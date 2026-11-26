import { useCallback, useEffect, useState } from 'react';
import type { JobView, LiveBatch, Snapshot } from '@yard/shared';
import { applyBatch, applySnapshot, emptyState, type DashboardState } from './state';

export function useLive(): DashboardState & { merge: (jobs: JobView[]) => void } {
  const [state, setState] = useState(emptyState);

  const merge = useCallback((jobs: JobView[]) => {
    setState((current) => applyBatch(current, { jobs, now: Date.now() }));
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/events');
    const onSnapshot = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as Snapshot;
      setState((current) => applySnapshot(current, payload));
    };
    const onBatch = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as LiveBatch;
      setState((current) => applyBatch(current, payload));
    };
    source.addEventListener('snapshot', onSnapshot);
    source.addEventListener('batch', onBatch);
    source.onopen = () => setState((current) => ({ ...current, connected: true }));
    source.onerror = () => setState((current) => ({ ...current, connected: false }));
    return () => source.close();
  }, []);

  return { ...state, merge };
}

export function useClock(offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const timer = window.setInterval(() => setNow(Date.now() + offset), 200);
    return () => window.clearInterval(timer);
  }, [offset]);
  return now;
}
