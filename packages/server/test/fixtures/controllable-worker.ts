import { parentPort } from 'node:worker_threads';
import { isCancelled } from '../../src/pool/cancel';

if (!parentPort) {
  throw new Error('controllable worker must run inside a Worker');
}

const port = parentPort;

port.on('message', (msg: {
  type?: string;
  jobId?: string;
  jobType?: string;
  params?: Record<string, unknown>;
  cancelFlag?: SharedArrayBuffer;
}) => {
  if (msg.type !== 'start' || !msg.jobId || !msg.jobType || !msg.cancelFlag) return;

  const jobId = msg.jobId;
  const params = msg.params ?? {};
  const flag = new Int32Array(msg.cancelFlag);

  try {
    if (msg.jobType === 'crash') {
      process.exit(1);
    }

    if (msg.jobType === 'spin') {
      const steps = Number(params.steps ?? 10);
      const iters = Number(params.iters ?? 100_000);
      for (let step = 1; step <= steps; step += 1) {
        if (isCancelled(flag)) {
          port.postMessage({ type: 'canceled', jobId });
          return;
        }
        let acc = 0;
        for (let i = 0; i < iters; i += 1) acc = (acc + i) | 0;
        if (acc === Number.MIN_SAFE_INTEGER) return;
        port.postMessage({
          type: 'progress',
          jobId,
          percent: Math.round((step / steps) * 100),
          message: `step ${step}`,
        });
      }
      port.postMessage({
        type: 'done',
        jobId,
        result: { tag: params.tag ?? null, steps },
      });
      return;
    }

    if (msg.jobType === 'ignore') {
      const ms = Number(params.ms ?? 5_000);
      const end = Date.now() + ms;
      while (Date.now() < end) {
        let acc = 0;
        for (let i = 0; i < 200_000; i += 1) acc = (acc + i) | 0;
        if (acc === Number.MIN_SAFE_INTEGER) return;
      }
      port.postMessage({ type: 'done', jobId, result: { ignored: true } });
      return;
    }

    if (msg.jobType === 'unordered') {
      const seq = Array.isArray(params.seq) ? params.seq : [];
      for (const percent of seq) {
        if (typeof percent !== 'number') continue;
        port.postMessage({ type: 'progress', jobId, percent });
      }
      port.postMessage({ type: 'done', jobId, result: { ok: true } });
      return;
    }

    port.postMessage({ type: 'error', jobId, message: `unknown ${msg.jobType}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed';
    port.postMessage({ type: 'error', jobId, message });
  }
});

port.postMessage({ type: 'ready' });
