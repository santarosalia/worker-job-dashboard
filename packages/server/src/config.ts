import { existsSync } from 'node:fs';
import os from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function defaultPoolSize(): number {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, cores - 1);
}

export interface AppConfig {
  host: string;
  port: number;
  poolSize: number;
  jobTimeoutMs: number;
  webDist: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: '0.0.0.0',
    port: env.PORT ? parseBoundedInt(env.PORT, 'PORT', 1, 65_535) : 8787,
    poolSize: env.POOL_SIZE ? parseBoundedInt(env.POOL_SIZE, 'POOL_SIZE', 1, 64) : defaultPoolSize(),
    jobTimeoutMs: env.JOB_TIMEOUT_MS ? parseBoundedInt(env.JOB_TIMEOUT_MS, 'JOB_TIMEOUT_MS', 50, 600_000) : 30_000,
    webDist: env.WEB_DIST ? resolve(env.WEB_DIST) : env.NODE_ENV === 'production' ? findWebDist() : null,
  };
}

export function staticRoot(directory: string): string {
  const absolute = isAbsolute(directory) ? directory : resolve(directory);
  const fromCwd = relative(process.cwd(), absolute);
  return fromCwd || '.';
}

function findWebDist(): string | null {
  const candidates = [
    fileURLToPath(new URL('../web', import.meta.url)),
    fileURLToPath(new URL('../../web/dist', import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function parseBoundedInt(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
