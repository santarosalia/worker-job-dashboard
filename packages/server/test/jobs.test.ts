import { describe, expect, it } from 'vitest';
import { CancelledError, type JobContext } from '../src/jobs/context';
import { blurAndHash } from '../src/jobs/blur';
import { estimatePi } from '../src/jobs/montecarlo';
import { countPrimes } from '../src/jobs/prime';
import { randomValues, sortArray } from '../src/jobs/sort';

function openContext(): { ctx: JobContext; percents: number[] } {
  const percents: number[] = [];
  const ctx: JobContext = {
    isCancelled: () => false,
    throwIfCancelled() {},
    report(percent) {
      percents.push(percent);
    },
  };
  return { ctx, percents };
}

function cancelAfter(percent: number): { ctx: JobContext; percents: number[] } {
  const percents: number[] = [];
  let cancelled = false;
  const ctx: JobContext = {
    isCancelled: () => cancelled,
    throwIfCancelled() {
      if (cancelled) throw new CancelledError();
    },
    report(value) {
      percents.push(value);
      if (value >= percent) cancelled = true;
    },
  };
  return { ctx, percents };
}

function referencePrimeCount(limit: number): number {
  let count = 0;
  for (let n = 2; n <= limit; n += 1) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= n; divisor += 1) {
      if (n % divisor === 0) {
        prime = false;
        break;
      }
    }
    if (prime) count += 1;
  }
  return count;
}

describe('job handlers', () => {
  it('counts primes and reports non-decreasing progress', () => {
    expect(countPrimes(1, openContext().ctx).count).toBe(0);
    expect(countPrimes(2, openContext().ctx).count).toBe(1);
    expect(countPrimes(10, openContext().ctx).count).toBe(4);
    expect(countPrimes(100, openContext().ctx).count).toBe(25);
    expect(countPrimes(200, openContext().ctx).count).toBe(referencePrimeCount(200));
    const { ctx, percents } = openContext();
    expect(countPrimes(1000, ctx).count).toBe(168);
    expect(percents.at(-1)).toBe(100);
    for (let index = 1; index < percents.length; index += 1) {
      expect(percents[index]).toBeGreaterThanOrEqual(percents[index - 1] ?? 0);
    }
  });

  it('stops prime counting when cancellation is requested', () => {
    const { ctx, percents } = cancelAfter(15);
    expect(() => countPrimes(3_000_000, ctx)).toThrow(CancelledError);
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThan(100);
  });

  it('sorts the same series the in-process reference sorts', () => {
    const { ctx, percents } = openContext();
    const length = 400;
    const seed = 42;
    const expected = Array.from(randomValues(length, seed)).sort((a, b) => a - b);
    const result = sortArray(length, seed, ctx);
    expect(result.head).toBe(expected[0]);
    expect(result.tail).toBe(expected[expected.length - 1]);
    expect(result.length).toBe(length);
    const again = sortArray(length, seed, openContext().ctx);
    expect(again.checksum).toBe(result.checksum);
    expect(percents.at(-1)).toBe(100);
  });

  it('stops a sort when cancellation is requested', () => {
    const { ctx } = cancelAfter(20);
    expect(() => sortArray(400_000, 3, ctx)).toThrow(CancelledError);
  });

  it('blurs and hashes deterministically', () => {
    const { ctx, percents } = openContext();
    const result = blurAndHash(48, 2, 2_000, ctx);
    const again = blurAndHash(48, 2, 2_000, openContext().ctx);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(again.digest).toBe(result.digest);
    expect(percents.at(-1)).toBe(100);
  });

  it('estimates pi from a seeded monte carlo run and can cancel', () => {
    const { ctx, percents } = openContext();
    const result = estimatePi(200_000, 7, ctx);
    const again = estimatePi(200_000, 7, openContext().ctx);
    expect(result.pi).toBe(again.pi);
    expect(result.pi).toBeGreaterThan(2.9);
    expect(result.pi).toBeLessThan(3.4);
    expect(result.inside).toBeLessThanOrEqual(result.samples);
    expect(percents.at(-1)).toBe(100);

    const cancelling = cancelAfter(30);
    expect(() => estimatePi(5_000_000, 1, cancelling.ctx)).toThrow(CancelledError);
  });
});
