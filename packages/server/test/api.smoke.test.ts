import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../src/create-runtime';

let stop: (() => Promise<void>) | undefined;
let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (closeServer) await closeServer();
  if (stop) await stop();
  closeServer = undefined;
  stop = undefined;
});

async function start(poolSize = 1) {
  const runtime = createRuntime({ poolSize, jobTimeoutMs: 20_000 });
  const server = serve({ fetch: runtime.app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  stop = () => runtime.stop();
  closeServer = () =>
    new Promise((resolve, reject) => {
      (server as Server).closeAllConnections?.();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  return { base: `http://127.0.0.1:${address.port}`, pool: runtime.pool };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('HTTP API', () => {
  it('submits, lists, reads, cancels, retries, and streams a snapshot', async () => {
    const { base } = await start(1);

    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    const healthBody = await readJson(health);
    expect(healthBody.ok).toBe(true);

    const bad = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"type":',
    });
    expect(bad.status).toBe(400);

    const rejected = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'prime', params: { limit: 3 } }),
    });
    expect(rejected.status).toBe(400);

    const events = await fetch(`${base}/api/events`);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    const reader = events.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('event: snapshot');
    await reader!.cancel();

    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'sort', params: { length: 2_000_000, seed: 1 }, timeoutMs: 20_000 }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { job: { id: string; state: string } };
    const jobId = createdBody.job.id;

    await waitFor(() => fetch(`${base}/api/jobs/${jobId}`).then((response) => response.json()), (body: { job: { state: string } }) => body.job.state === 'running');

    const bulk = await fetch(`${base}/api/jobs/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'montecarlo', params: { samples: 100_000, seed: 2 }, count: 3 }),
    });
    expect(bulk.status).toBe(201);
    const bulkBody = (await bulk.json()) as { jobs: Array<{ id: string; state: string }> };
    expect(bulkBody.jobs).toHaveLength(3);
    const queued = bulkBody.jobs.find((job) => job.state === 'queued') ?? bulkBody.jobs[1];
    expect(queued).toBeTruthy();

    const canceled = await fetch(`${base}/api/jobs/${queued!.id}/cancel`, { method: 'POST' });
    expect(canceled.status).toBe(200);

    const missing = await fetch(`${base}/api/jobs/job_missing`);
    expect(missing.status).toBe(404);

    const timed = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'montecarlo', params: { samples: 25_000_000, seed: 1 }, timeoutMs: 120 }),
    });
    const timedBody = (await timed.json()) as { job: { id: string } };

    await waitFor(
      () => fetch(`${base}/api/jobs/${timedBody.job.id}`).then((response) => response.json()),
      (body: { job: { state: string; error: string | null } }) => body.job.state === 'failed' && /timed out/.test(body.job.error ?? ''),
    );

    const retried = await fetch(`${base}/api/jobs/${timedBody.job.id}/retry`, { method: 'POST' });
    expect(retried.status).toBe(201);
    const retriedBody = (await retried.json()) as { job: { id: string; retryOf: string; attempt: number } };
    expect(retriedBody.job.retryOf).toBe(timedBody.job.id);
    expect(retriedBody.job.attempt).toBe(2);

    const list = await fetch(`${base}/api/jobs?limit=20`);
    const listBody = (await list.json()) as { jobs: Array<{ id: string }> };
    const ids = listBody.jobs.map((job) => job.id);
    expect(ids).toContain(jobId);
    expect(ids).toContain(retriedBody.job.id);

    const pool = await fetch(`${base}/api/pool`);
    const poolBody = (await pool.json()) as { pool: { size: number; lag: { lagMs: number }; workers: unknown[] } };
    expect(poolBody.pool.size).toBe(1);
    expect(poolBody.pool.workers).toHaveLength(1);
    expect(typeof poolBody.pool.lag.lagMs).toBe('number');

    await fetch(`${base}/api/jobs/${jobId}/cancel`, { method: 'POST' });
    await fetch(`${base}/api/jobs/${retriedBody.job.id}/cancel`, { method: 'POST' });
  });
});

async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeoutMs = 12_000): Promise<T> {
  const started = Date.now();
  let last: T | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await read();
    if (ready(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`condition not met: ${JSON.stringify(last)}`);
}
