import { test, expect } from '@playwright/test';
import { emptyLG } from '../shared/lg';

test('desktop onboarding clears the token and renders only discovered capabilities', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.addInitScript(initial => {
    let snapshot = initial;
    const listeners = new Set<(value: typeof snapshot) => void>();
    const publish = () => { listeners.forEach(fn => fn(structuredClone(snapshot))); return Promise.resolve(snapshot); };
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        openTokenPage: async () => {},
        connect: async () => {
          snapshot = { ...initial, connected: true, devices: [{ id: 'synthetic-ac', name: 'LG da sala', model: 'Teste' }], selectedId: 'synthetic-ac',
            state: { power: true, target: 23, current: 26, mode: 'COOL', fan: 'AUTO', swing: null, eco: null, sleepHours: null },
            capabilities: { power: true, temperature: { min: 18, max: 30, step: .5 }, modes: ['COOL', 'FAN'], fanSpeeds: ['AUTO', 'LOW'], swing: false, eco: false, sleep: false }, updatedAt: Date.now() };
          return publish();
        },
        disconnect: async () => { snapshot = initial; return publish(); },
        select: async () => snapshot, refresh: async () => snapshot,
        command: async (_id, command) => {
          snapshot = { ...snapshot, busy: true, notice: 'Enviando comando…' }; await publish();
          await new Promise(resolve => setTimeout(resolve, 1500));
          snapshot = { ...snapshot, busy: false, notice: null, state: { ...snapshot.state!, [command.field]: command.value } }; return publish();
        },
      },
    };
  }, emptyLG);
  await page.goto('/');
  await page.getByRole('button', { name: 'Configurar LG ThinQ' }).click();
  const token = page.getByLabel('Token pessoal', { exact: true });
  await expect(token).toHaveAttribute('type', 'password');
  await token.fill('thinqpat_synthetic-ui-test');
  await page.getByRole('button', { name: 'Conectar LG ThinQ', exact: true }).click();
  await expect(token).toHaveCount(0);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'LG da sala' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eco' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Secar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aumentar temperatura' }).click();
  await expect(page.getByRole('button', { name: 'Desligar aparelho' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Ajustando seu clima');
  await page.screenshot({ path: 'artifacts/lg-command-loading.png' });
  await expect(page.locator('.temperature-number')).toContainText('23.5');
  await expect(page.locator('.command-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.screenshot({ path: 'artifacts/lg-live-test.png' });
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('button', { name: 'Desconectar conta' }).click();
  await expect(token).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('thinqpat_');
  await page.screenshot({ path: 'artifacts/lg-connect-test.png' });
});

test('long device details and errors stay inside the native content scroller', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 650 });
  await page.addInitScript(initial => {
    const snapshot = { ...initial, connected: true, devices: [{ id: 'test', name: 'Ar-condicionado da sala com nome muito extenso para o painel', model: 'MODELO'.repeat(20) }], selectedId: 'test', error: 'A LG ainda não confirmou a operação. '.repeat(30) };
    window.glacialpoint = { isDesktop: true, listIntegrations: async () => [], lg: {
      snapshot: async () => snapshot, subscribe: () => () => {}, connect: async () => snapshot,
      disconnect: async () => snapshot, select: async () => snapshot, refresh: async () => snapshot,
      command: async () => snapshot, openTokenPage: async () => {},
    } };
  }, emptyLG);
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  const sizes = await page.evaluate(() => {
    const content = document.querySelector('.live-lg')!;
    return { pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
      contentFitsWidth: content.scrollWidth <= content.clientWidth, internalScroll: content.scrollHeight > content.clientHeight };
  });
  expect(sizes).toEqual({ pageFits: true, contentFitsWidth: true, internalScroll: true });
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/lg-long-content.png' });
});

test('tutorial da LG abre do painel, do formulário e volta para onde estava', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.addInitScript(initial => {
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => initial, subscribe: () => () => {}, connect: async () => initial, disconnect: async () => initial,
        select: async () => initial, refresh: async () => initial, command: async () => initial, energy: async () => ({}),
        openTokenPage: async () => { (window as unknown as { __portalOpened: boolean }).__portalOpened = true; },
      },
    };
  }, emptyLG);
  await page.goto('/');
  await page.getByRole('button', { name: 'Como conectar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Como conectar seu LG.' })).toBeVisible();
  await expect(page.getByText(/ADD NEW TOKEN/)).toBeVisible();
  await page.getByText(/Entre na sua conta/).evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'artifacts/lg-guide-qr.png' });
  await page.getByText(/Crie e copie o token/).evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'artifacts/lg-guide-token.png' });
  await page.getByRole('button', { name: 'Abrir portal de tokens da LG ↗' }).click();
  expect(await page.evaluate(() => (window as unknown as { __portalOpened?: boolean }).__portalOpened)).toBe(true);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu LG, por perto.' })).toBeVisible();
  await page.getByRole('button', { name: 'Como conectar', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar LG ThinQ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Do seu jeito.' })).toBeVisible();
  await page.getByRole('region', { name: 'Conexão LG ThinQ' }).getByRole('button', { name: 'Passo a passo de conexão' }).click();
  await expect(page.getByRole('heading', { name: 'Como conectar seu LG.' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Do seu jeito.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/lg-guide.png' });
});

test('cabeçalho vira o puxador da janela no desktop', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.addInitScript(initial => {
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => initial, subscribe: () => () => {}, connect: async () => initial, disconnect: async () => initial,
        select: async () => initial, refresh: async () => initial, command: async () => initial, energy: async () => ({}),
        openTokenPage: async () => {},
      },
    };
  }, emptyLG);
  await page.goto('/');
  const regions = await page.evaluate(() => {
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return (style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region')).trim();
    };
    const header = document.querySelector('.panel-header');
    const button = header?.querySelector('button');
    return header && button ? { header: read(header), button: read(button) } : null;
  });
  expect(regions).toEqual({ header: 'drag', button: 'no-drag' });
});
