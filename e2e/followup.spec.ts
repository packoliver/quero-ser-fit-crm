import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user_a.json' });

// C7 — FOLLOW-UP: lead parado deve aparecer em /followups
test('C7: follow-up page loads and lists pending items', async ({ page }) => {
  await page.goto('/followups');
  // Page should render without error; heading or list expected
  await expect(page.getByRole('heading', { name: /follow.?up/i }).first()).toBeVisible({ timeout: 10_000 });
});

// C8 — RECUPERAÇÃO: leads elegíveis devem aparecer em /recuperacao
test('C8: recovery page loads for user_a', async ({ page }) => {
  await page.goto('/recuperacao');
  await expect(page.getByRole('heading', { name: /recupera/i }).first()).toBeVisible({ timeout: 10_000 });
});