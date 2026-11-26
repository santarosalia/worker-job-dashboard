import * as esbuild from 'esbuild';

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
});
