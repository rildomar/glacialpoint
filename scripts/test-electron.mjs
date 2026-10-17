import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
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
  assert.equal(await page.locator('.desktop').count(), 1, 'Native bridge must enable the desktop composition');
  assert.equal(await page.locator('.preview-header').count(), 0, 'Browser preview chrome must be absent');
  const integrations = await page.evaluate(() => window.glacialpoint.listIntegrations());
  assert.deepEqual(integrations.map(item => item.id), ['lg', 'elgin']);
  assert.equal(integrations[0].availability, 'available');
  assert.equal((await page.evaluate(() => window.glacialpoint.lg.snapshot())).connected, false);
  if (!executablePath) {
    assert.equal((await page.evaluate(() => window.glacialpoint.energySettings.read())).tariff, null);
    await page.evaluate(() => window.glacialpoint.energySettings.save(.95));
    await page.reload();
    assert.equal((await page.evaluate(() => window.glacialpoint.energySettings.read())).tariff, .95);
    await page.evaluate(() => window.glacialpoint.energySettings.save(null));
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
  const request = await page.evaluate(() => { window.open('https://example.com'); return true; });
  assert.equal(request, true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Closing must preserve the tray process');
  await mkdir('artifacts', { recursive: true });
  console.log('Desktop checks passed: packaged UI, IPC, renderer isolation, blocked popups, close-to-tray.');
} finally {
  await application.close();
}
