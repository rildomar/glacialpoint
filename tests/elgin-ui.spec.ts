import { test, expect } from '@playwright/test';
import { emptyElgin } from '../shared/elgin';
import { emptyLG } from '../shared/lg';

test('conexão Elgin limpa credenciais e controla só o que o aparelho anuncia', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.addInitScript(({ initial, initialLG }) => {
    let snapshot = initial;
    const listeners = new Set<(value: typeof initial) => void>();
    const publish = () => { listeners.forEach(fn => fn(structuredClone(snapshot))); return Promise.resolve(snapshot); };
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => initialLG, subscribe: () => () => {}, connect: async () => initialLG,
        disconnect: async () => initialLG, select: async () => initialLG, refresh: async () => initialLG,
        command: async () => initialLG, openTokenPage: async () => {}, energy: async () => ({}),
      },
      elgin: {
        snapshot: async () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        connect: async project => {
          (window as unknown as { __elginProject: typeof project }).__elginProject = project;
          snapshot = { ...initial, connected: true,
            devices: [{ id: 'elgin-escritorio', name: 'Ar - escritório', model: 'Elgin Eco Inverter' }], selectedId: 'elgin-escritorio',
            state: { power: true, mode: 'cold', current: 27, target: 24, eco: null, sleep: false, light: null, lock: null, swingHorizontal: true },
            capabilities: { power: true, temperature: { min: 16, max: 90, step: 1, scale: 1 }, modes: ['cold', 'wind'], swingHorizontal: true, eco: false, sleep: true, light: false, lock: false },
            updatedAt: Date.now() };
          return publish();
        },
        disconnect: async () => { snapshot = initial; return publish(); },
        select: async () => snapshot, refresh: async () => snapshot,
        command: async (_id, command) => {
          snapshot = { ...snapshot, busy: true, notice: 'Enviando comando…' };
          await publish();
          await new Promise(resolve => setTimeout(resolve, 1500));
          const state = { ...snapshot.state!, [command.field]: command.value };
          snapshot = { ...snapshot, busy: false, notice: null, state };
          return publish();
        },
      },
    };
  }, { initial: emptyElgin, initialLG: emptyLG });
  await page.goto('/');

  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  const accessId = page.getByLabel('Access ID', { exact: true });
  const secret = page.getByLabel('Access Secret', { exact: true });
  await expect(accessId).toBeVisible();
  await expect(secret).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Região do projeto')).toHaveValue('us');
  await accessId.fill('elgin-ui-access-id-0001');
  await secret.fill('elgin-ui-secret-0001');
  await page.getByRole('button', { name: 'Conectar Elgin', exact: true }).click();
  await expect(accessId).toHaveCount(0);
  const afterConnect = await page.evaluate(() => ({
    project: (window as unknown as { __elginProject: unknown }).__elginProject,
    storage: JSON.stringify(localStorage),
  }));
  expect(afterConnect.project).toEqual({ accessId: 'elgin-ui-access-id-0001', accessSecret: 'elgin-ui-secret-0001', region: 'us' });
  expect(afterConnect.storage).not.toContain('elgin-ui-secret-0001');
  expect(afterConnect.storage).not.toContain('elgin-ui-access-id-0001');

  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ar - escritório' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eco' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Luz' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trava' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aquecer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Oscilar' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Dormir' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('16° a 30° · Celsius')).toBeVisible();
  await expect(page.locator('.temperature-number')).toContainText('24');

  await page.getByRole('button', { name: 'Aumentar temperatura' }).click();
  await expect(page.getByRole('button', { name: 'Desligar aparelho' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Ajustando seu clima');
  await page.screenshot({ path: 'artifacts/elgin-command-loading.png' });
  await expect(page.locator('.command-overlay')).toHaveCount(0);
  await expect(page.locator('.temperature-number')).toContainText('25');

  await page.getByRole('button', { name: 'Ventilar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ventilar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.command-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aumentar temperatura' })).toBeDisabled();
  await page.getByRole('button', { name: 'Resfriar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resfriar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Aumentar temperatura' })).toBeEnabled();
  expect(await page.evaluate(() => {
    const content = document.querySelector('.live-elgin')!;
    return document.documentElement.scrollWidth <= innerWidth && content.scrollWidth <= content.clientWidth;
  })).toBe(true);
  await page.screenshot({ path: 'artifacts/elgin-live-test.png' });

  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('button', { name: 'Desconectar Elgin' }).click();
  await expect(page.getByLabel('Access ID', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Access Secret', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('elgin-ui-secret-0001');
  await page.screenshot({ path: 'artifacts/elgin-connect-test.png' });
});

test('duas integrações conectadas alternam entre LG e Elgin e lembram a escolha', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  const lg = { ...emptyLG, connected: true,
    devices: [{ id: 'lg-sala', name: 'LG da sala', model: 'Teste' }], selectedId: 'lg-sala',
    state: { power: true, target: 23, current: 26, mode: 'COOL', fan: 'AUTO', swing: null, eco: null, sleepHours: null },
    capabilities: { power: true, temperature: { min: 18, max: 30, step: 1 }, modes: ['COOL'], fanSpeeds: [], swing: false, eco: false, sleep: false },
    updatedAt: Date.now() };
  const elgin = { ...emptyElgin, connected: true,
    devices: [{ id: 'elgin-escritorio', name: 'Ar - escritório', model: 'Elgin Eco Inverter' }], selectedId: 'elgin-escritorio',
    state: { power: true, mode: 'cold', current: 27, target: 24, eco: false, sleep: false, light: true, lock: false, swingHorizontal: false },
    capabilities: { power: true, temperature: { min: 16, max: 90, step: 1, scale: 1 }, modes: ['cold'], swingHorizontal: true, eco: true, sleep: true, light: true, lock: true },
    updatedAt: Date.now() };
  await page.addInitScript(({ lg, elgin }) => {
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => lg, subscribe: () => () => {}, connect: async () => lg, disconnect: async () => lg,
        select: async () => lg, refresh: async () => lg, command: async () => lg, openTokenPage: async () => {}, energy: async () => ({}),
      },
      elgin: {
        snapshot: async () => elgin, subscribe: () => () => {}, connect: async () => elgin, disconnect: async () => elgin,
        select: async () => elgin, refresh: async () => elgin, command: async () => elgin,
      },
    };
  }, { lg, elgin });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LG da sala' })).toBeVisible();
  const tabs = page.getByRole('group', { name: 'Integrações conectadas' });
  await expect(tabs.getByRole('button')).toHaveCount(2);
  await tabs.getByRole('button', { name: 'Elgin Smart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ar - escritório' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eco', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/elgin-tabs-test.png' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ar - escritório' })).toBeVisible();
});

test('conectar o Elgin com o LG ativo leva direto ao painel Elgin', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  const lg = { ...emptyLG, connected: true,
    devices: [{ id: 'lg-sala', name: 'LG da sala', model: 'Teste' }], selectedId: 'lg-sala',
    state: { power: true, target: 23, current: 26, mode: 'COOL', fan: 'AUTO', swing: null, eco: null, sleepHours: null },
    capabilities: { power: true, temperature: { min: 18, max: 30, step: 1 }, modes: ['COOL'], fanSpeeds: [], swing: false, eco: false, sleep: false },
    updatedAt: Date.now() };
  await page.addInitScript(({ lg, initial }) => {
    let snapshot = initial;
    const listeners = new Set<(value: typeof initial) => void>();
    const publish = () => { listeners.forEach(fn => fn(structuredClone(snapshot))); return Promise.resolve(snapshot); };
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => lg, subscribe: () => () => {}, connect: async () => lg, disconnect: async () => lg,
        select: async () => lg, refresh: async () => lg, command: async () => lg, openTokenPage: async () => {}, energy: async () => ({}),
      },
      elgin: {
        snapshot: async () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        connect: async () => {
          snapshot = { ...initial, connected: true,
            devices: [{ id: 'elgin-escritorio', name: 'Ar - escritório', model: 'Elgin Eco Inverter' }], selectedId: 'elgin-escritorio',
            state: { power: true, mode: 'cold', current: 27, target: 24, eco: false, sleep: false, light: true, lock: false, swingHorizontal: false },
            capabilities: { power: true, temperature: { min: 16, max: 90, step: 1, scale: 1 }, modes: ['cold'], swingHorizontal: true, eco: true, sleep: true, light: true, lock: true },
            updatedAt: Date.now() };
          return publish();
        },
        disconnect: async () => { snapshot = initial; return publish(); },
        select: async () => snapshot, refresh: async () => snapshot, command: async () => snapshot,
      },
    };
  }, { lg, initial: emptyElgin });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LG da sala' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByLabel('Access ID', { exact: true }).fill('elgin-ui-access-id-0002');
  await page.getByLabel('Access Secret', { exact: true }).fill('elgin-ui-secret-0002');
  await page.getByRole('button', { name: 'Conectar Elgin', exact: true }).click();
  await expect(page.getByLabel('Access ID', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ar - escritório' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Integrações conectadas' })).toBeVisible();
});
