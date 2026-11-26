export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`job not found: ${id}`);
    this.name = 'JobNotFoundError';
  }
}

export class InvalidJobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobStateError';
  }
}
