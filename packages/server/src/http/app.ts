import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import type { LiveBatch, PoolView, Snapshot } from '@yard/shared';
import { staticRoot } from '../config';
import { InvalidJobStateError, JobNotFoundError } from '../pool/errors';
import type { WorkerPool } from '../pool/worker-pool';
import { parseBulk, parseSubmit } from './parse';
import type { EventHub } from '../realtime/hub';

export interface AppDeps {
  pool: WorkerPool;
  hub: EventHub;
  snapshot: () => Snapshot;
  poolView: () => PoolView;
  staticDir?: string | null;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, poolSize: deps.pool.snapshot().size }));

  app.get('/api/pool', (c) => c.json({ pool: deps.poolView() }));

  app.get('/api/jobs', (c) => {
    const raw = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(raw) ? Math.min(500, Math.max(1, Math.floor(raw))) : 100;
    return c.json({ jobs: deps.pool.list(limit) });
  });

  app.get('/api/jobs/:id', (c) => {
    const job = deps.pool.get(c.req.param('id'));
    if (!job) return c.json({ error: 'job not found' }, 404);
    return c.json({ job });
  });

  app.post('/api/jobs/bulk', async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const parsed = parseBulk(body.value);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const jobs = [];
    for (let index = 0; index < parsed.value.count; index += 1) {
      jobs.push(deps.pool.submit({ type: parsed.value.type, params: parsed.value.params, timeoutMs: parsed.value.timeoutMs }));
    }
    return c.json({ jobs }, 201);
  });

  app.post('/api/jobs', async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const parsed = parseSubmit(body.value);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const job = deps.pool.submit({ type: parsed.value.type, params: parsed.value.params, timeoutMs: parsed.value.timeoutMs });
    return c.json({ job }, 201);
  });

  app.post('/api/jobs/:id/cancel', (c) => {
    try {
      return c.json({ job: deps.pool.cancel(c.req.param('id')) });
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.post('/api/jobs/:id/retry', (c) => {
    try {
      return c.json({ job: deps.pool.retry(c.req.param('id')) }, 201);
    } catch (error) {
      return mapError(c, error);
    }
  });

  app.get('/api/events', (c) => {
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let closed = false;
      const pending: LiveBatch[] = [];
      let listening = false;
      let chain = Promise.resolve();

      const send = (event: string, data: unknown) => {
        chain = chain
          .then(() => {
            if (closed) return undefined;
            return stream.writeSSE({ event, data: JSON.stringify(data) });
          })
          .catch(() => {
            closed = true;
          });
        return chain;
      };

      const unsubscribe = deps.hub.subscribe((batch) => {
        if (!listening) {
          pending.push(batch);
          return;
        }
        void send('batch', batch);
      });

      const stop = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
      };
      stream.onAbort(stop);

      const shot = deps.snapshot();
      listening = true;
      await stream.writeSSE({ event: 'snapshot', data: JSON.stringify(shot) });
      for (const batch of pending) void send('batch', batch);
      pending.length = 0;

      while (!closed) {
        await stream.sleep(10_000);
        if (closed) break;
        await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      stop();
    });
  });

  if (deps.staticDir) {
    const root = staticRoot(deps.staticDir);
    app.use('/assets/*', serveStatic({ root }));
    app.get('/favicon.svg', serveStatic({ root, path: 'favicon.svg' }));
    app.get('/', serveStatic({ root, path: 'index.html' }));
  } else {
    app.get('/', (c) => c.json({ name: 'yard', health: '/api/health', events: '/api/events' }));
  }

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}

async function readJson(c: { req: { text: () => Promise<string> } }): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const text = await c.req.text();
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

function mapError(c: { json: (body: unknown, status?: number) => Response }, error: unknown): Response {
  if (error instanceof JobNotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof InvalidJobStateError) return c.json({ error: error.message }, 409);
  console.error(error);
  return c.json({ error: 'internal error' }, 500);
}
