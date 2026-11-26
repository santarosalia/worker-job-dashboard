import { createHash } from 'node:crypto';
import type { BlurResult } from '@yard/shared';
import type { JobContext } from './context';
import { formatCompact } from './format';

const RADIUS = 2;

export function blurAndHash(size: number, passes: number, hashRounds: number, ctx: JobContext): BlurResult {
  const cells = size * size;
  const src = new Float64Array(cells);
  const tmp = new Float64Array(cells);
  for (let index = 0; index < cells; index += 1) {
    src[index] = ((index * 17) ^ (index >>> 3)) % 255;
  }

  for (let pass = 1; pass <= passes; pass += 1) {
    ctx.throwIfCancelled();
    for (let y = 0; y < size; y += 1) {
      if ((y & 15) === 0) ctx.throwIfCancelled();
      const row = y * size;
      for (let x = 0; x < size; x += 1) {
        let sum = 0;
        let count = 0;
        const from = Math.max(0, x - RADIUS);
        const to = Math.min(size - 1, x + RADIUS);
        for (let sample = from; sample <= to; sample += 1) {
          sum += src[row + sample]!;
          count += 1;
        }
        tmp[row + x] = sum / count;
      }
    }
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        let sum = 0;
        let count = 0;
        const from = Math.max(0, y - RADIUS);
        const to = Math.min(size - 1, y + RADIUS);
        for (let sample = from; sample <= to; sample += 1) {
          sum += tmp[sample * size + x]!;
          count += 1;
        }
        src[y * size + x] = sum / count;
      }
    }
    ctx.report((pass / passes) * 70, `blur pass ${pass} / ${passes}`);
  }

  const sample = Buffer.alloc(64);
  for (let index = 0; index < sample.length; index += 1) {
    sample[index] = Math.floor(Math.abs(src[(index * 997) % cells]!)) & 0xff;
  }

  let digest = createHash('sha256').update(sample).digest();
  const step = Math.max(1, Math.floor(hashRounds / 40));
  for (let round = 1; round <= hashRounds; round += 1) {
    if (round % 2_000 === 0) ctx.throwIfCancelled();
    digest = createHash('sha256').update(digest).update(sample).digest();
    if (round % step === 0 || round === hashRounds) {
      ctx.report(70 + (round / hashRounds) * 30, `hashing ${formatCompact(round)} / ${formatCompact(hashRounds)}`);
    }
  }

  ctx.report(100, 'hash sealed');
  return { size, passes, hashRounds, digest: digest.toString('hex') };
}
