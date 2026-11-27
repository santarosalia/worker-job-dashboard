/** Cooperative cancel flag shared with a worker that may be inside a tight loop. */
export function createCancelFlag(): { flag: Int32Array; buffer: SharedArrayBuffer } {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  return { flag: new Int32Array(buffer), buffer };
}

export function requestCancel(flag: Int32Array): void {
  Atomics.store(flag, 0, 1);
}

export function isCancelled(flag: Int32Array): boolean {
  return Atomics.load(flag, 0) === 1;
}
