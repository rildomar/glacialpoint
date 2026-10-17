import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'artifacts/preview-dark.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Ativar tema claro' }).click();
  await page.screenshot({ path: 'artifacts/preview-light.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 364, height: 800 });
  await page.evaluate(() => {
    document.querySelector('.scene').classList.add('desktop');
    document.querySelector('.preview-header').remove();
    document.querySelector('.intro').remove();
    document.querySelector('.preview-footer').remove();
  });
  await page.screenshot({ path: 'artifacts/preview-panel.png', fullPage: true, animations: 'disabled' });
  console.log(await page.evaluate(() => ({ panelHeight: document.querySelector('.panel').getBoundingClientRect().height, scrollHeight: document.documentElement.scrollHeight })));
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.screenshot({ path: 'artifacts/preview-settings.png', fullPage: true, animations: 'disabled' });
  console.log('Captured dark and light previews in artifacts/.');
} finally {
  await browser.close();
}
