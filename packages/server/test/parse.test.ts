import { describe, expect, it } from 'vitest';
import { PRESETS } from '@yard/shared';
import { parseBulk, parseSubmit } from '../src/http/parse';

describe('parseSubmit', () => {
  it('fills the yard preset when params are omitted', () => {
    const parsed = parseSubmit({ type: 'prime' });
    expect(parsed).toEqual({
      ok: true,
      value: {
        type: 'prime',
        params: { ...PRESETS.prime.yard },
        timeoutMs: 30_000,
      },
    });
  });

  it('accepts an in-range prime limit and an explicit timeout', () => {
    const parsed = parseSubmit({ type: 'prime', params: { limit: 20_000 }, timeoutMs: 1500 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.params).toEqual({ limit: 20_000 });
      expect(parsed.value.timeoutMs).toBe(1500);
    }
  });

  it('rejects unknown types, fractional numbers, and out-of-range limits', () => {
    expect(parseSubmit({ type: 'nope' }).ok).toBe(false);
    expect(parseSubmit(null).ok).toBe(false);
    expect(parseSubmit({ type: 'prime', params: { limit: 12.5 } }).ok).toBe(false);
    expect(parseSubmit({ type: 'prime', params: { limit: 10 } }).ok).toBe(false);
    expect(parseSubmit({ type: 'sort', params: { length: 1000 }, timeoutMs: 10 }).ok).toBe(false);
  });

  it('defaults sort and monte carlo seeds', () => {
    const sort = parseSubmit({ type: 'sort', params: { length: 2000 } });
    const pi = parseSubmit({ type: 'montecarlo', params: { samples: 100_000 } });
    expect(sort.ok && sort.value.params).toMatchObject({ length: 2000, seed: 1 });
    expect(pi.ok && pi.value.params).toMatchObject({ samples: 100_000, seed: 1 });
  });
});

describe('parseBulk', () => {
  it('requires a count inside the bulk limit', () => {
    expect(parseBulk({ type: 'blur', count: 0 }).ok).toBe(false);
    expect(parseBulk({ type: 'blur', count: 201 }).ok).toBe(false);
    const parsed = parseBulk({ type: 'blur', count: 50 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.count).toBe(50);
      expect(parsed.value.params).toEqual({ ...PRESETS.blur.yard });
    }
  });
});
