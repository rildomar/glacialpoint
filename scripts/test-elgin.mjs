import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/elgin-core.test.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'artifacts/elgin-core.test.cjs' });
const result = spawnSync(process.execPath, ['--test', 'artifacts/elgin-core.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
