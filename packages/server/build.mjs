import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);

rmSync('dist', { recursive: true, force: true });

await esbuild.build({
  entryPoints: {
    index: 'src/index.ts',
    worker: 'src/worker/worker.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  external: ['piscina'],
});

// Piscina loads its own worker.js from the package directory. Keep the package
// next to the bundle so `node dist/index.js` resolves it, including in the
// image that copies only dist/.
// `piscina/package.json` is not exported. The public entry lives in dist/.
const piscinaRoot = dirname(dirname(require.resolve('piscina')));
cpSync(piscinaRoot, join('dist', 'node_modules', 'piscina'), { recursive: true, dereference: true });
