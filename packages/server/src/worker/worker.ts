import { parentPort } from 'node:worker_threads';
import { CancelledError, type JobContext } from '../jobs/context';
import { runJob } from '../jobs/run';
import { isCancelled } from '../pool/cancel';
import type { StartMessage } from '../pool/protocol';

if (!parentPort) {
  throw new Error('job worker must run inside a Worker');
}

const port = parentPort;
let busy = false;

port.on('message', (message: Partial<StartMessage>) => {
  if (message?.type !== 'start' || !message.jobId || !message.jobType || !message.cancelFlag) return;
  const jobId = message.jobId;
  if (busy) {
    port.postMessage({ type: 'error', jobId, message: 'worker is busy' });
    return;
  }

  busy = true;
  try {
    const flag = new Int32Array(message.cancelFlag);
    let lastSent = 0;
    let lastPercent = -1;
    const ctx: JobContext = {
      isCancelled: () => isCancelled(flag),
      throwIfCancelled() {
        if (isCancelled(flag)) throw new CancelledError();
      },
      report(percent, text) {
        const clamped = Math.max(0, Math.min(100, percent));
        const now = Date.now();
        if (clamped < 100 && now - lastSent < 40 && clamped - lastPercent < 0.8) return;
        lastSent = now;
        lastPercent = clamped;
        port.postMessage({ type: 'progress', jobId, percent: clamped, message: text });
      },
    };
    const result = runJob(message.jobType, message.params ?? {}, ctx);
    ctx.report(100);
    port.postMessage({ type: 'done', jobId, result });
  } catch (error) {
    if (error instanceof CancelledError) {
      port.postMessage({ type: 'canceled', jobId });
    } else {
      const text = error instanceof Error ? error.message : 'job failed';
      port.postMessage({ type: 'error', jobId, message: text });
    }
  } finally {
    busy = false;
  }
});

port.postMessage({ type: 'ready' });
