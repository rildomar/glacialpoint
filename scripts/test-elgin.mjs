import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/elgin-core.test.ts', 'tests/elgin-push.test.ts', 'tests/elgin-energy.test.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'artifacts', outExtension: { '.js': '.cjs' }, external: ['bufferutil', 'utf-8-validate'] });
const result = spawnSync(process.execPath, ['--test', 'artifacts/elgin-core.test.cjs', 'artifacts/elgin-push.test.cjs', 'artifacts/elgin-energy.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
