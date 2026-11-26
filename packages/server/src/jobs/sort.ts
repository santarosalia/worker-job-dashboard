import type { SortResult } from '@yard/shared';
import type { JobContext } from './context';
import { formatCompact } from './format';

export function randomValues(length: number, seed: number): Float64Array {
  return fillRandom(length, seed, () => {});
}

export function sortArray(length: number, seed: number, ctx: JobContext): SortResult {
  const src: Float64Array = fillRandom(length, seed, (index) => {
    ctx.throwIfCancelled();
    if (index > 0 && index % 131_072 === 0) {
      ctx.report((index / length) * 15, `filling ${formatCompact(index)} / ${formatCompact(length)}`);
    }
  });

  let from: Float64Array = src;
  let into: Float64Array = new Float64Array(length);
  const passes = Math.max(1, Math.ceil(Math.log2(Math.max(length, 2))));
  let pass = 0;

  for (let width = 1; width < length; width *= 2) {
    ctx.throwIfCancelled();
    pass += 1;
    for (let start = 0; start < length; start += width * 2) {
      if ((start & 262_143) === 0) ctx.throwIfCancelled();
      const mid = Math.min(start + width, length);
      const right = Math.min(start + width * 2, length);
      let leftCursor = start;
      let rightCursor = mid;
      for (let cursor = start; cursor < right; cursor += 1) {
        if (rightCursor >= right || (leftCursor < mid && from[leftCursor]! <= from[rightCursor]!)) {
          into[cursor] = from[leftCursor]!;
          leftCursor += 1;
        } else {
          into[cursor] = from[rightCursor]!;
          rightCursor += 1;
        }
      }
    }
    const swap = from;
    from = into;
    into = swap;
    ctx.report(15 + (pass / passes) * 85, `merging pass ${pass} / ${passes}`);
  }

  for (let index = 1; index < from.length; index += 1) {
    if ((index & 131_071) === 0) ctx.throwIfCancelled();
    if (from[index]! < from[index - 1]!) throw new Error('sort invariant failed');
  }

  let checksum = 0;
  for (let index = 0; index < from.length; index += 1024) {
    checksum = Math.imul(checksum ^ Math.floor(from[index]! * 1_000_000), 16_777_619);
  }

  ctx.report(100, `sorted ${formatCompact(length)}`);
  return {
    length,
    checksum: checksum >>> 0,
    head: from[0] ?? 0,
    tail: from[from.length - 1] ?? 0,
  };
}

function fillRandom(length: number, seed: number, onChunk: (index: number) => void): Float64Array {
  const data = new Float64Array(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    if ((index & 65_535) === 0) onChunk(index);
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    data[index] = state / 4_294_967_296;
  }
  return data;
}
