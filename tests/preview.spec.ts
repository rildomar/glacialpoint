import { test, expect } from '@playwright/test';

test('demo controls enforce power, mode and temperature limits', async ({ page }) => {
  await page.goto('/');
  const temperature = page.getByRole('slider', { name: 'Temperatura desejada' });
  await expect(temperature).toHaveAttribute('aria-valuenow', '23');
  await temperature.focus();
  await page.keyboard.press('ArrowUp');
  await expect(temperature).toHaveAttribute('aria-valuenow', '24');
  await page.keyboard.press('End');
  await expect(temperature).toHaveAttribute('aria-valuenow', '30');
  await page.keyboard.press('ArrowUp');
  await expect(temperature).toHaveAttribute('aria-valuenow', '30');
  await page.getByRole('button', { name: 'Secar', exact: true }).click();
  await expect(temperature).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Desligar aparelho simulado' }).click();
  await expect(page.getByRole('button', { name: 'Eco', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Alta', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Ligar aparelho simulado' }).click();
  await page.getByRole('button', { name: 'Resfriar', exact: true }).click();
  await expect(temperature).toHaveAttribute('aria-disabled', 'false');
  // O clique solto no meio do arco define o valor central da escala (24°).
  const box = (await temperature.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(temperature).toHaveAttribute('aria-valuenow', '24');
});

test('only demo devices appear and settings preserve control state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Eco', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Aparelhos da demonstração' }).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Elgin' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configurações e integrações' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Baixa', exact: true }).check();
  await page.getByRole('radio', { name: 'Baixa', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Média', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByText('Elgin Smart', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Reduzir transparência' }).click();
  await expect(page.getByRole('switch', { name: 'Reduzir transparência' })).toBeChecked();
  await page.getByRole('switch', { name: 'Tema claro' }).click();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Eco', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio', { name: 'Média', exact: true })).toBeChecked();
});

test('preview fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Abrir configurações' })).toBeVisible();
});

test('integration suggestions are explicitly local drafts and survive reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('button', { name: 'Sugerir integração' }).click();
  await page.getByRole('textbox', { name: 'Marca ou aplicativo' }).fill('Marca de teste');
  await page.getByRole('textbox', { name: 'Modelo e detalhes' }).fill('Modelo de teste');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status')).toContainText('Nenhuma sugestão foi enviada');
  await page.reload();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('button', { name: 'Sugerir integração' }).click();
  await expect(page.getByRole('textbox', { name: 'Marca ou aplicativo' })).toHaveValue('Marca de teste');
});

test('desktop composition fits the configured window height', async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 });
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('.scene')!.classList.add('desktop');
    document.querySelector('.preview-header')!.remove();
    document.querySelector('.intro')!.remove();
    document.querySelector('.preview-footer')!.remove();
  });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
