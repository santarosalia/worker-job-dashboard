import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { createRuntime } from './create-runtime';

const config = loadConfig();
const runtime = createRuntime({
  poolSize: config.poolSize,
  jobTimeoutMs: config.jobTimeoutMs,
  staticDir: config.webDist,
});

const server = serve({
  fetch: runtime.app.fetch,
  hostname: config.host,
  port: config.port,
});

console.log(`yard listening on http://${config.host}:${config.port} (pool ${config.poolSize})`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
