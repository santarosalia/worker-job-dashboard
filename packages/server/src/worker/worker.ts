import { threadId } from 'node:worker_threads';
import { CancelledError, type JobContext } from '../jobs/context';
import { runJob } from '../jobs/run';
import { isCancelled } from '../pool/cancel';
import type { JobTask, TaskResult } from '../pool/task';

export default function runTask(task: JobTask): TaskResult {
  const port = task.port;
  port.unref();
  const flag = new Int32Array(task.cancelFlag);
  port.postMessage({ type: 'start', threadId });

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
      port.postMessage({ type: 'progress', percent: clamped, message: text });
    },
  };

  try {
    const result = runJob(task.jobType, task.params ?? {}, ctx);
    ctx.report(100);
    return { threadId, canceled: false, result };
  } catch (error) {
    if (error instanceof CancelledError) return { threadId, canceled: true, result: null };
    throw error;
  }
}
