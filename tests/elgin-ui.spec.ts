import { test, expect } from '@playwright/test';
import { emptyElgin } from '../shared/elgin';
import { emptyLG } from '../shared/lg';
import { energyPeriods } from '../shared/energy';

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
  await expect(page.getByRole('group', { name: 'Aparelhos conectados' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Eco' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Luz' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trava' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aquecer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Oscilar' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Dormir' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.dial-number')).toContainText('24');
  await expect(page.locator('.dial-ambient-value')).toContainText('27');

  const dial = page.getByRole('slider', { name: 'Temperatura desejada' });
  await dial.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Desligar aparelho' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Ajustando seu clima');
  await page.screenshot({ path: 'artifacts/elgin-command-loading.png' });
  await expect(page.locator('.command-overlay')).toHaveCount(0);
  await expect(page.locator('.dial-number')).toContainText('25');

  await page.getByRole('button', { name: 'Ventilar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ventilar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.command-overlay')).toHaveCount(0);
  await expect(dial).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Resfriar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resfriar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dial).toHaveAttribute('aria-disabled', 'false');
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
  await expect(page.getByRole('group', { name: 'Aparelhos conectados' })).toHaveCount(0);
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

test('consumo estimado do Elgin deixa claro que o aparelho não mede energia', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  const elgin = { ...emptyElgin, connected: true,
    devices: [{ id: 'elgin-escritorio', name: 'Ar - escritório', model: 'Elgin Eco Inverter' }], selectedId: 'elgin-escritorio',
    state: { power: true, mode: 'cold', current: 27, target: 24, eco: false, sleep: false, light: true, lock: false, swingHorizontal: false },
    capabilities: { power: true, temperature: { min: 16, max: 90, step: 1, scale: 1 }, modes: ['cold'], swingHorizontal: true, eco: true, sleep: true, light: true, lock: true },
    updatedAt: Date.now() };
  await page.addInitScript(({ lg, elgin, dates }) => {
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      energySettings: { read: async () => ({ tariff: 0.9, averagePower: 0.7 }), save: async settings => settings },
      lg: {
        snapshot: async () => lg, subscribe: () => () => {}, connect: async () => lg, disconnect: async () => lg,
        select: async () => lg, refresh: async () => lg, command: async () => lg, openTokenPage: async () => {}, energy: async () => ({}),
      },
      elgin: {
        snapshot: async () => elgin, subscribe: () => () => {}, connect: async () => elgin, disconnect: async () => elgin,
        select: async () => elgin, refresh: async () => elgin, command: async () => elgin,
        energy: async id => ({ deviceId: id, daily: dates.daily.map((date, i) => ({ date, kwh: i === 29 ? 0.4 : null })), monthly: dates.monthly.map((date, i) => ({ date, kwh: i === 5 ? 2.1 : null })), supported: true, updatedAt: Date.now(), error: null, source: 'estimate' }),
      },
    };
  }, { lg: emptyLG, elgin, dates: energyPeriods() });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir consumo' }).click();
  await expect(page.getByRole('heading', { name: 'Seu consumo.' })).toBeVisible();
  await expect(page.getByText('ESTIMATIVA', { exact: true })).toBeVisible();
  await expect(page.locator('.energy-today-value')).toContainText('0,4');
  await expect(page.locator('.energy-value')).toContainText('2,1');
  await expect(page.locator('.energy-estimate strong')).toContainText('1,89');
  await expect(page.getByText(/não mede energia/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Integrações conectadas' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Aparelhos conectados' })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/elgin-energy-test.png' });
});

test('Elgin com dois aparelhos mostra o seletor e troca o ativo', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  const elgin = { ...emptyElgin, connected: true,
    devices: [
      { id: 'elgin-escritorio', name: 'Ar - escritório', model: 'Elgin Eco Inverter' },
      { id: 'elgin-sala', name: 'Ar da sala', model: 'Elgin Eco Inverter' },
    ], selectedId: 'elgin-escritorio',
    state: { power: true, mode: 'cold', current: 27, target: 24, eco: false, sleep: false, light: true, lock: false, swingHorizontal: false },
    capabilities: { power: true, temperature: { min: 16, max: 90, step: 1, scale: 1 }, modes: ['cold'], swingHorizontal: true, eco: true, sleep: true, light: true, lock: true },
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
        connect: async () => snapshot, disconnect: async () => snapshot,
        select: async id => { snapshot = { ...snapshot, selectedId: id }; return publish(); },
        refresh: async () => snapshot, command: async () => snapshot,
      },
    };
  }, { lg: emptyLG, initial: elgin });
  await page.goto('/');
  const tabs = page.getByRole('group', { name: 'Aparelhos conectados' });
  await expect(tabs.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Ar - escritório' })).toBeVisible();
  await tabs.getByRole('button', { name: 'Ar da sala' }).click();
  await expect(page.getByRole('heading', { name: 'Ar da sala' })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Ar da sala' })).toHaveAttribute('aria-pressed', 'true');
});

test('consumo troca de integração direto na tela de análise', async ({ page }) => {
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
  await page.addInitScript(({ lg, elgin, dates }) => {
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      energySettings: { read: async () => ({ tariff: 0.9, averagePower: 0.7 }), save: async settings => settings },
      lg: {
        snapshot: async () => lg, subscribe: () => () => {}, connect: async () => lg, disconnect: async () => lg,
        select: async () => lg, refresh: async () => lg, command: async () => lg, openTokenPage: async () => {},
        energy: async id => ({ deviceId: id, daily: dates.daily.map((date, i) => ({ date, kwh: i === 29 ? 1.25 : null })), monthly: dates.monthly.map((date, i) => ({ date, kwh: i === 5 ? 42.5 : null })), supported: true, updatedAt: Date.now(), error: null, source: 'cloud' }),
      },
      elgin: {
        snapshot: async () => elgin, subscribe: () => () => {}, connect: async () => elgin, disconnect: async () => elgin,
        select: async () => elgin, refresh: async () => elgin, command: async () => elgin,
        energy: async id => ({ deviceId: id, daily: dates.daily.map((date, i) => ({ date, kwh: i === 29 ? 0.4 : null })), monthly: dates.monthly.map((date, i) => ({ date, kwh: i === 5 ? 2.1 : null })), supported: true, updatedAt: Date.now(), error: null, source: 'estimate' }),
      },
    };
  }, { lg, elgin, dates: energyPeriods() });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir consumo' }).click();
  await expect(page.locator('.energy-device')).toHaveText('LG da sala');
  await expect(page.locator('.energy-value')).toContainText('42,5');
  const tabs = page.getByRole('group', { name: 'Integrações conectadas' });
  await expect(tabs.getByRole('button')).toHaveCount(2);
  await tabs.getByRole('button', { name: 'Elgin Smart', exact: true }).click();
  await expect(page.locator('.energy-device')).toHaveText('Ar - escritório');
  await expect(page.getByText('ESTIMATIVA', { exact: true })).toBeVisible();
  await expect(page.locator('.energy-value')).toContainText('2,1');
  await expect(tabs.getByRole('button', { name: 'Elgin Smart', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.energy-content .back-link').click();
  await expect(page.getByRole('heading', { name: 'Ar - escritório' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Integrações conectadas' }).getByRole('button', { name: 'Elgin Smart', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('tutorial do Elgin abre do painel e leva às configurações', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.addInitScript(({ lg, initial }) => {
    localStorage.setItem('glacialpoint.provider', 'elgin');
    window.glacialpoint = {
      isDesktop: true, listIntegrations: async () => [],
      lg: {
        snapshot: async () => lg, subscribe: () => () => {}, connect: async () => lg, disconnect: async () => lg,
        select: async () => lg, refresh: async () => lg, command: async () => lg, openTokenPage: async () => {}, energy: async () => ({}),
      },
      elgin: {
        snapshot: async () => initial, subscribe: () => () => {}, connect: async () => initial, disconnect: async () => initial,
        select: async () => initial, refresh: async () => initial, command: async () => initial,
        openConsolePage: async () => { (window as unknown as { __consoleOpened: boolean }).__consoleOpened = true; },
      },
    };
  }, { lg: emptyLG, initial: emptyElgin });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu Elgin, no ponto.' })).toBeVisible();
  await page.getByRole('button', { name: 'Como conectar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Como conectar seu Elgin.' })).toBeVisible();
  await expect(page.getByText(/Vincule sua conta Smart Life/)).toBeVisible();
  await page.getByText(/Ative os serviços do projeto/).evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'artifacts/elgin-guide-services.png' });
  await page.getByText(/Vincule sua conta Smart Life/).evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'artifacts/elgin-guide-qr.png' });
  await page.getByRole('button', { name: 'Abrir Tuya IoT ↗' }).click();
  expect(await page.evaluate(() => (window as unknown as { __consoleOpened?: boolean }).__consoleOpened)).toBe(true);
  await page.getByRole('button', { name: 'Configurar Elgin Smart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Do seu jeito.' })).toBeVisible();
  await page.getByRole('region', { name: 'Conexão Elgin Smart' }).getByRole('button', { name: 'Passo a passo de conexão' }).click();
  await expect(page.getByRole('heading', { name: 'Como conectar seu Elgin.' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Do seu jeito.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/elgin-guide.png' });
});
