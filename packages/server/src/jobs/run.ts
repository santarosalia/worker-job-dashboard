import type { JobContext } from './context';
import { blurAndHash } from './blur';
import { estimatePi } from './montecarlo';
import { countPrimes } from './prime';
import { sortArray } from './sort';

export function runJob(type: string, params: Record<string, unknown>, ctx: JobContext): unknown {
  switch (type) {
    case 'prime':
      return countPrimes(requiredNumber(params, 'limit'), ctx);
    case 'sort':
      return sortArray(requiredNumber(params, 'length'), requiredNumber(params, 'seed'), ctx);
    case 'blur':
      return blurAndHash(
        requiredNumber(params, 'size'),
        requiredNumber(params, 'passes'),
        requiredNumber(params, 'hashRounds'),
        ctx,
      );
    case 'montecarlo':
      return estimatePi(requiredNumber(params, 'samples'), requiredNumber(params, 'seed'), ctx);
    default:
      throw new Error(`unknown job type ${type}`);
  }
}

function requiredNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`invalid ${key}`);
  return value;
}
