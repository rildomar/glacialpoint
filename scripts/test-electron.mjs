import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

await build({ entryPoints: ['electron/credential-store.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: 'artifacts/credential-store-test.cjs' });

const userData = await mkdtemp(path.join(tmpdir(), 'glacialpoint-desktop-test-'));
const environment = { ...process.env, GLACIALPOINT_TEST_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.GLACIALPOINT_TEST_EXE;
const application = await electron.launch({
  ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
  env: environment,
});
try {
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: 'Seu LG, por perto.' }).waitFor();
  // A janela só aparece depois do ready-to-show; esperar o show de verdade
  // evita simular o arrasto antes do primeiro showPanel, que ancora na bandeja.
  await application.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isVisible()) resolve();
    else win.once('show', () => resolve());
  }));
  assert.equal(await page.locator('.desktop').count(), 1, 'Native bridge must enable the desktop composition');
  assert.equal(await page.locator('.preview-header').count(), 0, 'Browser preview chrome must be absent');
  const regions = await page.evaluate(() => {
    const read = element => { const style = getComputedStyle(element); return (style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region')).trim(); };
    const header = document.querySelector('.panel-header');
    const button = header?.querySelector('button');
    return header && button ? { header: read(header), button: read(button) } : null;
  });
  assert.deepEqual(regions, { header: 'drag', button: 'no-drag' }, 'O cabeçalho precisa ser a área de arrasto da janela');
  const integrations = await page.evaluate(() => window.glacialpoint.listIntegrations());
  assert.deepEqual(integrations.map(item => item.id), ['lg', 'elgin']);
  assert.equal(integrations[0].availability, 'available');
  assert.equal((await page.evaluate(() => window.glacialpoint.lg.snapshot())).connected, false);
  if (!executablePath) {
    assert.deepEqual(await page.evaluate(() => window.glacialpoint.energySettings.read()), { tariff: null, averagePower: null });
    await page.evaluate(() => window.glacialpoint.energySettings.save({ tariff: .95, averagePower: .7 }));
    await page.reload();
    assert.deepEqual(await page.evaluate(() => window.glacialpoint.energySettings.read()), { tariff: .95, averagePower: .7 });
    await page.evaluate(() => window.glacialpoint.energySettings.save({ tariff: null, averagePower: null }));
  }
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
  });
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  const storage = await application.evaluate(({ safeStorage }, { modulePath, directory }) => {
    const require = process.getBuiltinModule('module').createRequire(modulePath);
    const { credentialStore } = require(modulePath);
    const { readFileSync } = require('node:fs');
    const path = require('node:path');
    const vault = credentialStore(directory);
    const value = { token: 'thinqpat_synthetic-storage-test', clientId: 'synthetic', selectedId: null };
    vault.write(value);
    const encrypted = !readFileSync(path.join(directory, 'lg-credential.bin')).includes(value.token);
    const roundTrip = vault.read().token === value.token;
    vault.write({ ...value, selectedId: 'second' });
    const replaced = vault.read().selectedId === 'second';
    vault.clear();
    return { available: safeStorage.isEncryptionAvailable(), encrypted, roundTrip, replaced, cleared: vault.read() === null };
  }, { modulePath: path.resolve('artifacts/credential-store-test.cjs'), directory: path.join(userData, 'vault-test') });
  assert.deepEqual(storage, { available: true, encrypted: true, roundTrip: true, replaced: true, cleared: true });
  const moved = await application.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const { workArea } = screen.getPrimaryDisplay();
    win.setPosition(workArea.x + 80, workArea.y + 80);
    const [x, y] = win.getPosition();
    return { x, y };
  });
  await page.waitForTimeout(900);
  const stored = JSON.parse(await readFile(path.join(userData, 'panel-position.json'), 'utf8'));
  assert.deepEqual({ x: stored.x, y: stored.y }, moved, 'A posição arrastada precisa ser guardada');
  await application.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows()[0].hide(); app.emit('activate'); });
  const restored = await application.evaluate(({ BrowserWindow, screen }, point) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    return { visible: win.isVisible(), x, y, width, height, work: screen.getDisplayNearestPoint(point).workArea };
  }, moved);
  const clampInto = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));
  assert.equal(restored.visible, true, 'A janela precisa reabrir na posição lembrada');
  assert.equal(restored.x, clampInto(moved.x, restored.work.x, restored.work.x + restored.work.width - restored.width), 'O painel precisa reabrir na posição lembrada');
  assert.equal(restored.y, clampInto(moved.y, restored.work.y, restored.work.y + restored.work.height - restored.height), 'O painel precisa reabrir na posição lembrada');
  await writeFile(path.join(userData, 'panel-position.json'), JSON.stringify({ version: 1, x: 99999, y: 99999 }));
  await application.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows()[0].hide(); app.emit('activate'); });
  const clamped = await application.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    return { bounds, workAreas: screen.getAllDisplays().map(display => display.workArea) };
  });
  const fits = clamped.workAreas.some(area => clamped.bounds.x >= area.x && clamped.bounds.y >= area.y && clamped.bounds.x + clamped.bounds.width <= area.x + area.width && clamped.bounds.y + clamped.bounds.height <= area.y + area.height);
  assert.equal(fits, true, 'Posição fora da tela precisa voltar para dentro da área útil');
  const request = await page.evaluate(() => { window.open('https://example.com'); return true; });
  assert.equal(request, true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Closing must preserve the tray process');
  await mkdir('artifacts', { recursive: true });
  console.log('Desktop checks passed: packaged UI, IPC, renderer isolation, blocked popups, close-to-tray, window position memory.');
} finally {
  await application.close();
}
