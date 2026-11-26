import {
  DEFAULT_TIMEOUT_MS,
  PARAM_LIMITS,
  PRESETS,
  isJobType,
  type JobType,
} from '@yard/shared';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SubmitBody {
  type: JobType;
  params: Record<string, number>;
  timeoutMs: number;
}

export function parseSubmit(body: unknown): ParseResult<SubmitBody> {
  if (!isRecord(body)) return { ok: false, error: 'body must be an object' };
  if (typeof body.type !== 'string' || !isJobType(body.type)) {
    return { ok: false, error: 'type must be prime, sort, blur, or montecarlo' };
  }
  if (body.params !== undefined && !isRecord(body.params)) return { ok: false, error: 'params must be an object' };

  const params = readParams(body.type, isRecord(body.params) ? body.params : {});
  if (typeof params === 'string') return { ok: false, error: params };

  const timeout = readTimeout(body.timeoutMs);
  if (typeof timeout === 'string') return { ok: false, error: timeout };

  return { ok: true, value: { type: body.type, params, timeoutMs: timeout } };
}

export function parseBulk(body: unknown): ParseResult<SubmitBody & { count: number }> {
  if (!isRecord(body)) return { ok: false, error: 'body must be an object' };
  const count = readInt(body.count, 'count', PARAM_LIMITS.bulk.min, PARAM_LIMITS.bulk.max);
  if (typeof count === 'string') return { ok: false, error: count };
  const parsed = parseSubmit({ type: body.type, params: body.params, timeoutMs: body.timeoutMs });
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...parsed.value, count } };
}

function readParams(type: JobType, raw: Record<string, unknown>): Record<string, number> | string {
  if (type === 'prime') {
    const limit = readInt(raw.limit ?? PRESETS.prime.yard.limit, 'limit', PARAM_LIMITS.prime.limit.min, PARAM_LIMITS.prime.limit.max);
    return typeof limit === 'string' ? limit : { limit };
  }
  if (type === 'sort') {
    const length = readInt(raw.length ?? PRESETS.sort.yard.length, 'length', PARAM_LIMITS.sort.length.min, PARAM_LIMITS.sort.length.max);
    const seed = readInt(raw.seed ?? PRESETS.sort.yard.seed, 'seed', PARAM_LIMITS.sort.seed.min, PARAM_LIMITS.sort.seed.max);
    if (typeof length === 'string') return length;
    if (typeof seed === 'string') return seed;
    return { length, seed };
  }
  if (type === 'blur') {
    const size = readInt(raw.size ?? PRESETS.blur.yard.size, 'size', PARAM_LIMITS.blur.size.min, PARAM_LIMITS.blur.size.max);
    const passes = readInt(raw.passes ?? PRESETS.blur.yard.passes, 'passes', PARAM_LIMITS.blur.passes.min, PARAM_LIMITS.blur.passes.max);
    const hashRounds = readInt(
      raw.hashRounds ?? PRESETS.blur.yard.hashRounds,
      'hashRounds',
      PARAM_LIMITS.blur.hashRounds.min,
      PARAM_LIMITS.blur.hashRounds.max,
    );
    if (typeof size === 'string') return size;
    if (typeof passes === 'string') return passes;
    if (typeof hashRounds === 'string') return hashRounds;
    return { size, passes, hashRounds };
  }
  const samples = readInt(
    raw.samples ?? PRESETS.montecarlo.yard.samples,
    'samples',
    PARAM_LIMITS.montecarlo.samples.min,
    PARAM_LIMITS.montecarlo.samples.max,
  );
  const seed = readInt(raw.seed ?? PRESETS.montecarlo.yard.seed, 'seed', PARAM_LIMITS.montecarlo.seed.min, PARAM_LIMITS.montecarlo.seed.max);
  if (typeof samples === 'string') return samples;
  if (typeof seed === 'string') return seed;
  return { samples, seed };
}

function readTimeout(value: unknown): number | string {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  return readInt(value, 'timeoutMs', PARAM_LIMITS.timeoutMs.min, PARAM_LIMITS.timeoutMs.max);
}

function readInt(value: unknown, name: string, min: number, max: number): number | string {
  if (typeof value !== 'number' || !Number.isInteger(value)) return `${name} must be an integer`;
  if (value < min || value > max) return `${name} must be between ${min} and ${max}`;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
