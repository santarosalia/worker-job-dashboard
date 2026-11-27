import type { MessagePort } from 'node:worker_threads';

/** One piscina task. The port is transferred; the cancel flag is shared. */
export interface JobTask {
  jobType: string;
  params: Record<string, unknown>;
  port: MessagePort;
  cancelFlag: SharedArrayBuffer;
}

export interface TaskResult {
  threadId: number;
  canceled: boolean;
  result: unknown;
}

export type WorkerNote =
  | { type: 'start'; threadId: number }
  | { type: 'progress'; percent: number; message?: string };

export function readWorkerNote(value: unknown): WorkerNote | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'start' && Number.isInteger(message.threadId)) {
    return { type: 'start', threadId: message.threadId as number };
  }
  if (message.type === 'progress' && typeof message.percent === 'number') {
    return {
      type: 'progress',
      percent: message.percent,
      message: typeof message.message === 'string' ? message.message : undefined,
    };
  }
  return null;
}

export function readTaskResult(value: unknown): TaskResult | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (!Number.isInteger(message.threadId) || typeof message.canceled !== 'boolean') return null;
  return {
    threadId: message.threadId as number,
    canceled: message.canceled,
    result: message.result ?? null,
  };
}
