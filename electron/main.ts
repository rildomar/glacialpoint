import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listIntegrations } from './core/integrations';
import { LGSession } from './core/lg-session';
import { credentialStore } from './credential-store';
import { tariffStore } from './tariff-store';

const isDev = !app.isPackaged && process.argv.includes('--dev');
const developmentUrl = 'http://127.0.0.1:1421';
const root = path.join(__dirname, '..');
const productionUrl = pathToFileURL(path.join(root, 'dist/index.html')).href;
const applicationUrl = isDev ? developmentUrl : productionUrl;
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let blurTimer: ReturnType<typeof setTimeout> | undefined;
let lg: LGSession;

function clearBlurTimer() {
  clearTimeout(blurTimer);
  blurTimer = undefined;
}

function showPanel() {
  if (!panel || panel.isDestroyed() || !tray) return;
  clearBlurTimer();
  const anchor = tray.getBounds();
  const work = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  const width = Math.min(364, work.width);
  const height = Math.min(800, work.height - 16);
  const x = Math.round(Math.max(work.x, Math.min(anchor.x + anchor.width / 2 - width / 2, work.x + work.width - width)));
  const above = anchor.y > work.y + work.height / 2;
  const y = Math.round(Math.max(work.y, Math.min(above ? anchor.y - height - 8 : anchor.y + anchor.height + 8, work.y + work.height - height)));
  panel.setBounds({ x, y, width, height });
  panel.show();
  panel.focus();
}

function createPanel() {
  panel = new BrowserWindow({
    width: 364, height: 800, show: false,
    title: 'GlacialPoint',
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, backgroundColor: '#203541',
    icon: path.join(root, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panel.webContents.on('will-navigate', event => event.preventDefault());
  panel.webContents.on('will-attach-webview', event => event.preventDefault());
  panel.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      panel?.hide();
    }
  });
  panel.on('close', event => {
    if (!quitting) { event.preventDefault(); panel?.hide(); }
  });
  // Wait briefly so a tray click can toggle a visible window before blur hides it.
  panel.on('blur', () => {
    clearBlurTimer();
    blurTimer = setTimeout(() => panel?.hide(), 150);
  });
  panel.on('focus', clearBlurTimer);
  panel.on('show', () => lg.setVisible(true));
  panel.on('hide', () => lg.setVisible(false));
  panel.once('ready-to-show', showPanel);
  void panel.loadURL(applicationUrl).catch(error => {
    console.error('Failed to load the GlacialPoint interface:', error.message);
    app.quit();
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(root, 'assets/icon.png')).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('GlacialPoint');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir GlacialPoint', click: showPanel },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.on('right-click', () => { clearBlurTimer(); tray?.popUpContextMenu(menu); });
  tray.on('click', () => {
    clearBlurTimer();
    if (panel?.isVisible()) panel.hide();
    else showPanel();
  });
}

app.setName('GlacialPoint');
// Isolate automated desktop tests from the user's preferences and single-instance lock.
if (!app.isPackaged && process.env.GLACIALPOINT_TEST_USER_DATA) {
  app.setPath('userData', process.env.GLACIALPOINT_TEST_USER_DATA);
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showPanel);
  app.on('activate', showPanel);
  app.on('before-quit', () => { quitting = true; clearBlurTimer(); lg?.dispose(); tray?.destroy(); });
  app.on('window-all-closed', () => { /* Keep the tray application running. */ });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.rildomar.glacialpoint');
    app.dock?.hide();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const trusted = (event: IpcMainInvokeEvent) => {
      if (!panel || event.sender !== panel.webContents || event.senderFrame !== panel.webContents.mainFrame || event.senderFrame.url !== applicationUrl && event.senderFrame.url !== `${applicationUrl}/`) {
        throw new Error('Untrusted integration request');
      }
    };
    lg = new LGSession(credentialStore(app.getPath('userData')), snapshot => {
      if (panel && !panel.isDestroyed()) panel.webContents.send('lg:changed', snapshot);
    });
    ipcMain.handle('integrations:list', event => { trusted(event); return listIntegrations(); });
    ipcMain.handle('lg:snapshot', event => { trusted(event); return lg.get(); });
    const tariffs = tariffStore(app.getPath('userData'));
    ipcMain.handle('energy:settings', event => { trusted(event); return tariffs.read(); });
    ipcMain.handle('energy:save-tariff', (event, value: unknown) => { trusted(event); return tariffs.write(value); });
    ipcMain.handle('lg:energy', (event, id: unknown) => { trusted(event); return lg.energy(id); });
    ipcMain.handle('lg:connect', (event, token: unknown) => { trusted(event); return lg.connect(token); });
    ipcMain.handle('lg:disconnect', event => { trusted(event); return lg.disconnect(); });
    ipcMain.handle('lg:select', (event, id: unknown) => { trusted(event); return lg.select(id); });
    ipcMain.handle('lg:refresh', event => { trusted(event); return lg.refresh(); });
    ipcMain.handle('lg:command', (event, id: unknown, command: unknown) => { trusted(event); return lg.command(id, command); });
    ipcMain.handle('lg:token-page', event => { trusted(event); return shell.openExternal('https://connect-pat.lgthinq.com/'); });
    powerMonitor.on('suspend', () => lg.suspend());
    powerMonitor.on('resume', () => lg.resume());
    createTray();
    createPanel();
    void lg.restore();
  }).catch(error => { console.error(error); app.exit(1); });
}
