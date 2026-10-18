import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/lg-core.test.ts', 'tests/lg-push.test.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'artifacts', outExtension: { '.js': '.cjs' }, external: ['bufferutil', 'utf-8-validate'] });
const result = spawnSync(process.execPath, ['--test', 'artifacts/lg-core.test.cjs', 'artifacts/lg-push.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
