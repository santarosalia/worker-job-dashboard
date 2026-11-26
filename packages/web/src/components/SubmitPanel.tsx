import { useState } from 'react';
import {
  PARAM_LIMITS,
  PRESETS,
  type BlurParams,
  type JobType,
  type JobView,
  type MonteCarloParams,
  type PresetName,
  type PrimeParams,
  type SortParams,
} from '@yard/shared';
import { submitJobs } from '../api';
import { TYPE_META } from '../format';

const TYPES: JobType[] = ['prime', 'sort', 'blur', 'montecarlo'];
const PRESET_NAMES: PresetName[] = ['short', 'yard', 'long'];

type Params = PrimeParams | SortParams | BlurParams | MonteCarloParams;

export function SubmitPanel({ onJobs }: { onJobs: (jobs: JobView[]) => void }) {
  const [type, setType] = useState<JobType>('prime');
  const [preset, setPreset] = useState<PresetName>('yard');
  const [params, setParams] = useState<Params>(PRESETS.prime.yard);
  const [count, setCount] = useState(50);
  const [timeoutSec, setTimeoutSec] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function chooseType(next: JobType) {
    setType(next);
    setPreset('yard');
    setParams(PRESETS[next].yard);
    setError(null);
  }

  function choosePreset(next: PresetName) {
    setPreset(next);
    setParams(PRESETS[type][next]);
  }

  function update(key: string, raw: string) {
    const value = Number(raw);
    setParams((current) => ({ ...current, [key]: value }) as Params);
  }

  async function run(amount = count) {
    setError(null);
    if (!Number.isInteger(amount) || amount < 1 || amount > PARAM_LIMITS.bulk.max) {
      setError(`Count must be an integer from 1 to ${PARAM_LIMITS.bulk.max}.`);
      return;
    }
    const timeoutMs = Math.round(timeoutSec * 1000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < PARAM_LIMITS.timeoutMs.min || timeoutMs > PARAM_LIMITS.timeoutMs.max) {
      setError('Timeout must be between 0.05s and 600s.');
      return;
    }
    const invalid = validate(type, params);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending(true);
    try {
      const jobs = await submitJobs({
        type,
        params: params as unknown as Record<string, number>,
        count: amount,
        timeoutMs,
      });
      onJobs(jobs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit jobs.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel submit">
      <header className="panel-head">
        <h2>Send work</h2>
        <p>Pick a job, then put a yard of them on the queue.</p>
      </header>

      <div className="type-grid" role="radiogroup" aria-label="Job type">
        {TYPES.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={type === item}
            className={type === item ? 'type on' : 'type'}
            onClick={() => chooseType(item)}
          >
            <i style={{ background: TYPE_META[item].color }} />
            <span>{TYPE_META[item].label}</span>
            <small>{TYPE_META[item].detail}</small>
          </button>
        ))}
      </div>

      <div className="presets" role="group" aria-label="Size preset">
        {PRESET_NAMES.map((name) => (
          <button key={name} type="button" className={preset === name ? 'chip on' : 'chip'} onClick={() => choosePreset(name)}>
            {name}
          </button>
        ))}
      </div>

      <div className="fields">
        <Fields type={type} params={params} onChange={update} />
        <label>
          Count
          <input
            type="number"
            min={1}
            max={PARAM_LIMITS.bulk.max}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label>
          Timeout (seconds)
          <input
            type="number"
            min={0.05}
            max={600}
            step={1}
            value={timeoutSec}
            onChange={(event) => setTimeoutSec(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="run-row">
        <button type="button" className="btn primary" disabled={pending} onClick={() => void run()}>
          {pending ? 'Sending…' : `Run ${count || 0} jobs`}
        </button>
        <button type="button" className="btn ghost" disabled={pending} onClick={() => void run(1)}>
          Run 1
        </button>
      </div>
      <p className="hint">Progress is batched every 100ms so a busy yard does not flood the browser.</p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Fields({
  type,
  params,
  onChange,
}: {
  type: JobType;
  params: Params;
  onChange: (key: string, value: string) => void;
}) {
  if (type === 'prime') {
    const value = params as PrimeParams;
    return <NumberField label="Limit" name="limit" value={value.limit} min={PARAM_LIMITS.prime.limit.min} max={PARAM_LIMITS.prime.limit.max} onChange={onChange} />;
  }
  if (type === 'sort') {
    const value = params as SortParams;
    return (
      <>
        <NumberField label="Length" name="length" value={value.length} min={PARAM_LIMITS.sort.length.min} max={PARAM_LIMITS.sort.length.max} onChange={onChange} />
        <NumberField label="Seed" name="seed" value={value.seed} min={PARAM_LIMITS.sort.seed.min} max={PARAM_LIMITS.sort.seed.max} onChange={onChange} />
      </>
    );
  }
  if (type === 'blur') {
    const value = params as BlurParams;
    return (
      <>
        <NumberField label="Size" name="size" value={value.size} min={PARAM_LIMITS.blur.size.min} max={PARAM_LIMITS.blur.size.max} onChange={onChange} />
        <NumberField label="Passes" name="passes" value={value.passes} min={PARAM_LIMITS.blur.passes.min} max={PARAM_LIMITS.blur.passes.max} onChange={onChange} />
        <NumberField label="Hash rounds" name="hashRounds" value={value.hashRounds} min={PARAM_LIMITS.blur.hashRounds.min} max={PARAM_LIMITS.blur.hashRounds.max} onChange={onChange} />
      </>
    );
  }
  const value = params as MonteCarloParams;
  return (
    <>
      <NumberField label="Samples" name="samples" value={value.samples} min={PARAM_LIMITS.montecarlo.samples.min} max={PARAM_LIMITS.montecarlo.samples.max} onChange={onChange} />
      <NumberField label="Seed" name="seed" value={value.seed} min={PARAM_LIMITS.montecarlo.seed.min} max={PARAM_LIMITS.montecarlo.seed.max} onChange={onChange} />
    </>
  );
}

function NumberField({
  label,
  name,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <label>
      {label}
      <input type="number" min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
}

function validate(type: JobType, params: Params): string | null {
  if (type === 'prime') return checkInt((params as PrimeParams).limit, 'Limit', PARAM_LIMITS.prime.limit);
  if (type === 'sort') {
    const value = params as SortParams;
    return checkInt(value.length, 'Length', PARAM_LIMITS.sort.length) ?? checkInt(value.seed, 'Seed', PARAM_LIMITS.sort.seed);
  }
  if (type === 'blur') {
    const value = params as BlurParams;
    return (
      checkInt(value.size, 'Size', PARAM_LIMITS.blur.size) ??
      checkInt(value.passes, 'Passes', PARAM_LIMITS.blur.passes) ??
      checkInt(value.hashRounds, 'Hash rounds', PARAM_LIMITS.blur.hashRounds)
    );
  }
  const value = params as MonteCarloParams;
  return checkInt(value.samples, 'Samples', PARAM_LIMITS.montecarlo.samples) ?? checkInt(value.seed, 'Seed', PARAM_LIMITS.montecarlo.seed);
}

function checkInt(value: number, label: string, bounds: { min: number; max: number }): string | null {
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    return `${label} must be an integer from ${bounds.min.toLocaleString('en-US')} to ${bounds.max.toLocaleString('en-US')}.`;
  }
  return null;
}
