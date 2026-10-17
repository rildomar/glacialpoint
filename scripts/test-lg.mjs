import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/lg-core.test.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'artifacts/lg-core.test.cjs' });
const result = spawnSync(process.execPath, ['--test', 'artifacts/lg-core.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
