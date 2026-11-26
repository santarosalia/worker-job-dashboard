import { defaultPoolSize } from './config';
import { createApp } from './http/app';
import { resolveWorkerEntry } from './worker-entry';
import { WorkerPool } from './pool/worker-pool';
import { EventLoopMonitor } from './realtime/event-loop';
import { EventHub } from './realtime/hub';
import { Runtime } from './runtime';

export interface RuntimeOptions {
  poolSize?: number;
  jobTimeoutMs?: number;
  workerUrl?: URL;
  staticDir?: string | null;
}

export function createRuntime(options: RuntimeOptions = {}) {
  const pool = new WorkerPool({
    size: options.poolSize ?? defaultPoolSize(),
    workerUrl: options.workerUrl ?? resolveWorkerEntry(),
    jobTimeoutMs: options.jobTimeoutMs ?? 30_000,
  });
  const lag = new EventLoopMonitor();
  const hub = new EventHub();
  const runtime = new Runtime(pool, lag, hub);
  runtime.start();
  const app = createApp({
    pool,
    hub,
    snapshot: () => runtime.snapshot(),
    poolView: () => runtime.poolView(),
    staticDir: options.staticDir ?? null,
  });

  return {
    pool,
    hub,
    runtime,
    app,
    stop: async () => {
      runtime.stop();
      await pool.destroy();
    },
  };
}
