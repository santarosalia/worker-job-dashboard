import type { PrimeResult } from '@yard/shared';
import type { JobContext } from './context';
import { formatCompact } from './format';

const SEGMENT = 1 << 16;

export function countPrimes(limit: number, ctx: JobContext): PrimeResult {
  if (limit < 2) {
    ctx.report(100, 'no primes below 2');
    return { count: 0, limit };
  }

  const root = Math.floor(Math.sqrt(limit));
  const small = new Uint8Array(root + 1);
  const primes: number[] = [];
  for (let value = 2; value <= root; value += 1) {
    if (small[value]) continue;
    primes.push(value);
    for (let multiple = value * value; multiple <= root; multiple += value) small[multiple] = 1;
  }

  const segment = new Uint8Array(SEGMENT);
  let count = 0;
  let low = 2;
  while (low <= limit) {
    ctx.throwIfCancelled();
    const high = Math.min(low + SEGMENT - 1, limit);
    const span = high - low + 1;
    segment.fill(0, 0, span);
    for (const prime of primes) {
      let start = Math.ceil(low / prime) * prime;
      if (start < prime * prime) start = prime * prime;
      for (let value = start; value <= high; value += prime) segment[value - low] = 1;
    }
    for (let value = low; value <= high; value += 1) {
      if (segment[value - low] === 0) count += 1;
    }
    ctx.report((high / limit) * 100, `sieving ${formatCompact(high)} / ${formatCompact(limit)}`);
    low = high + 1;
  }

  ctx.report(100, `${count.toLocaleString('en-US')} primes`);
  return { count, limit };
}
