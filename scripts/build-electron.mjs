import { build } from 'esbuild';

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  sourcemap: true,
});
