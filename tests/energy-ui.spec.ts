import { test, expect } from '@playwright/test';
import { emptyLG } from '../shared/lg';
import { energyPeriods } from '../shared/energy';
test('real-data screen, missing readings, tariff persistence and clearing estimates', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.addInitScript(({ initial, dates }) => {
    const snapshot = { ...initial, connected: true, devices: [{ id: 'energy-test', name: 'LG da sala', model: 'Teste' }], selectedId: 'energy-test' };
    window.glacialpoint = { isDesktop: true, listIntegrations: async () => [],
      energySettings: { read: async () => ({ tariff: JSON.parse(localStorage.getItem('test-tariff') ?? 'null') }), save: async tariff => { localStorage.setItem('test-tariff', JSON.stringify(tariff)); return { tariff }; } },
      lg: { snapshot: async () => snapshot, subscribe: () => () => {}, connect: async () => snapshot, disconnect: async () => initial, select: async () => snapshot, refresh: async () => snapshot, command: async () => snapshot, openTokenPage: async () => {},
        energy: async id => ({ deviceId: id, daily: dates.daily.map((date, i) => ({ date, kwh: i === 29 ? 6.249 : null })), monthly: dates.monthly.map((date, i) => ({ date, kwh: i === 5 ? 127.227 : i === 4 ? 243.804 : null })), supported: true, updatedAt: Date.now(), error: null }),
      } };
  }, { initial: emptyLG, dates: energyPeriods() });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir consumo' }).click();
  await expect(page.getByRole('heading', { name: 'Seu consumo.' })).toBeVisible();
  await expect(page.locator('.energy-value')).toContainText('127,227');
  await page.getByRole('button', { name: '30 dias', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Consumo diário em kWh' }).getByRole('button')).toHaveCount(30);
  await expect(page.locator('.energy-bars .missing')).toHaveCount(33);
  await page.getByRole('button', { name: 'Informar minha tarifa' }).click();
  await page.getByLabel('Tarifa por kWh (R$)').fill('0,95');
  await page.getByRole('button', { name: 'Salvar tarifa e voltar' }).click();
  await expect(page.locator('.energy-estimate strong')).toContainText('120,87');
  await page.screenshot({ path: 'artifacts/energy-desktop.png' });
  await page.reload(); await page.getByRole('button', { name: 'Abrir consumo' }).click();
  await expect(page.locator('.energy-estimate strong')).toContainText('120,87');
  await page.getByRole('button', { name: /Tarifa:.*editar/ }).click();
  await page.getByLabel('Tarifa por kWh (R$)').fill('-1');
  await page.getByRole('button', { name: 'Salvar tarifa e voltar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Tarifa por kWh (R$)').fill('');
  await page.getByRole('button', { name: 'Salvar tarifa e voltar' }).click();
  await expect(page.getByRole('button', { name: 'Informar minha tarifa' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
