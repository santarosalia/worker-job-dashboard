import { threadId } from 'node:worker_threads';
import { isCancelled } from '../../src/pool/cancel';
import type { JobTask, TaskResult } from '../../src/pool/task';

export default function runControllable(task: JobTask): TaskResult {
  const params = task.params ?? {};
  const flag = new Int32Array(task.cancelFlag);
  task.port.unref();
  task.port.postMessage({ type: 'start', threadId });

  if (task.jobType === 'crash') process.exit(1);

  if (task.jobType === 'spin') {
    const steps = Number(params.steps ?? 10);
    const iters = Number(params.iters ?? 100_000);
    for (let step = 1; step <= steps; step += 1) {
      if (isCancelled(flag)) return { threadId, canceled: true, result: null };
      let acc = 0;
      for (let i = 0; i < iters; i += 1) acc = (acc + i) | 0;
      if (acc === Number.MIN_SAFE_INTEGER) break;
      task.port.postMessage({
        type: 'progress',
        percent: Math.round((step / steps) * 100),
        message: `step ${step}`,
      });
    }
    return { threadId, canceled: false, result: { tag: params.tag ?? null, steps } };
  }

  if (task.jobType === 'ignore') {
    const ms = Number(params.ms ?? 5_000);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      let acc = 0;
      for (let i = 0; i < 200_000; i += 1) acc = (acc + i) | 0;
      if (acc === Number.MIN_SAFE_INTEGER) break;
    }
    return { threadId, canceled: false, result: { ignored: true } };
  }

  if (task.jobType === 'unordered') {
    const seq = Array.isArray(params.seq) ? params.seq : [];
    for (const percent of seq) {
      if (typeof percent !== 'number') continue;
      task.port.postMessage({ type: 'progress', percent });
    }
    return { threadId, canceled: false, result: { ok: true } };
  }

  throw new Error(`unknown ${task.jobType}`);
}
