import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolveWorkerEntry(): URL {
  const candidates = [
    new URL('./worker/worker.ts', import.meta.url),
    new URL('./worker/worker.js', import.meta.url),
    new URL('./worker.js', import.meta.url),
  ];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return candidates[2] ?? candidates[0]!;
}
