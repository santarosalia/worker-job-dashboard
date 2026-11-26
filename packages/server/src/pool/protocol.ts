export interface StartMessage {
  type: 'start';
  jobId: string;
  jobType: string;
  params: Record<string, unknown>;
  cancelFlag: SharedArrayBuffer;
}

export type WorkerToMain =
  | { type: 'ready' }
  | { type: 'progress'; jobId: string; percent: number; message?: string }
  | { type: 'done'; jobId: string; result: unknown }
  | { type: 'canceled'; jobId: string }
  | { type: 'error'; jobId: string; message: string };

export function readWorkerMessage(value: unknown): WorkerToMain | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready') return { type: 'ready' };

  if (typeof message.jobId !== 'string') return null;
  if (message.type === 'progress' && typeof message.percent === 'number') {
    return {
      type: 'progress',
      jobId: message.jobId,
      percent: message.percent,
      message: typeof message.message === 'string' ? message.message : undefined,
    };
  }
  if (message.type === 'done') return { type: 'done', jobId: message.jobId, result: message.result };
  if (message.type === 'canceled') return { type: 'canceled', jobId: message.jobId };
  if (message.type === 'error') {
    return {
      type: 'error',
      jobId: message.jobId,
      message: typeof message.message === 'string' ? message.message : 'job failed',
    };
  }
  return null;
}
