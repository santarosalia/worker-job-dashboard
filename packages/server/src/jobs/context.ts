export class CancelledError extends Error {
  constructor() {
    super('canceled');
    this.name = 'CancelledError';
  }
}

export interface JobContext {
  isCancelled(): boolean;
  throwIfCancelled(): void;
  report(percent: number, message?: string): void;
}
