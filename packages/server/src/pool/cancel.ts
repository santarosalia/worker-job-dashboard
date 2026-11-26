/** Cooperative cancel flag shared with a worker that may be inside a tight loop. */
export function createCancelFlag(): Int32Array {
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
}

export function requestCancel(flag: Int32Array): void {
  Atomics.store(flag, 0, 1);
}

export function isCancelled(flag: Int32Array): boolean {
  return Atomics.load(flag, 0) === 1;
}
