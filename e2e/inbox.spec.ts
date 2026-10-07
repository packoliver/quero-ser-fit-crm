import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user_a.json' });

test('smoke: inbox renders for user_a', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Cliente A1' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Conversas Conectadas ao Supabase')).toBeVisible();
});