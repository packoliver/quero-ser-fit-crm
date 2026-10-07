import { test as setup } from '@playwright/test';

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-mail Corporativo' }).fill(email);
  await page.getByRole('textbox', { name: /senha|password/i }).or(page.locator('input[type="password"]')).first().fill(password);
  await page.getByRole('button', { name: 'Entrar no CRM' }).click();
  // Wait for redirect to any authenticated route
  await page.waitForURL(/\/(inbox|dashboard|funil|clientes|analytics|configuracoes)/, { timeout: 15_000 });
}

setup('authenticate as user_a', async ({ page }) => {
  await login(page, 'user_a@test.local', 'test1234');
  await page.context().storageState({ path: 'e2e/.auth/user_a.json' });
});

setup('authenticate as user_b', async ({ page }) => {
  await login(page, 'user_b@test.local', 'test1234');
  await page.context().storageState({ path: 'e2e/.auth/user_b.json' });
});

setup('authenticate as admin_a', async ({ page }) => {
  await login(page, 'admin_a@test.local', 'test1234');
  await page.context().storageState({ path: 'e2e/.auth/admin_a.json' });
});