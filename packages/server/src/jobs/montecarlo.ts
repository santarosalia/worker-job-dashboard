import type { MonteCarloResult } from '@yard/shared';
import type { JobContext } from './context';
import { formatCompact } from './format';

export function estimatePi(samples: number, seed: number, ctx: JobContext): MonteCarloResult {
  let state = seed >>> 0 || 1;
  const rand = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };

  let inside = 0;
  const chunk = 100_000;
  for (let seen = 0; seen < samples; seen += chunk) {
    ctx.throwIfCancelled();
    const end = Math.min(samples, seen + chunk);
    for (let index = seen; index < end; index += 1) {
      const x = rand();
      const y = rand();
      if (x * x + y * y <= 1) inside += 1;
    }
    const pi = (4 * inside) / end;
    ctx.report((end / samples) * 100, `${formatCompact(end)} samples · π ≈ ${pi.toFixed(4)}`);
  }

  const pi = samples === 0 ? 0 : (4 * inside) / samples;
  ctx.report(100, `π ≈ ${pi.toFixed(5)}`);
  return { samples, inside, pi };
}
