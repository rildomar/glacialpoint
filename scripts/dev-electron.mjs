import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import './build-electron.mjs';

const server = await createServer({ server: { host: '127.0.0.1', port: 1421, strictPort: true } });
await server.listen();
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', '--dev'], { stdio: 'inherit', env: environment, windowsHide: true });
async function stop(code = 0) {
  await server.close();
  process.exit(code);
}
child.on('exit', code => void stop(code ?? 0));
child.on('error', error => { console.error(error); void stop(1); });
process.on('SIGINT', () => { child.kill(); });
