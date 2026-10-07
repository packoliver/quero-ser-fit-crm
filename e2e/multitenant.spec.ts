import { test, expect } from '@playwright/test';

// C10 — MULTI-TENANT: user_b must NOT see ORG_A data
test.use({ storageState: 'e2e/.auth/user_b.json' });

test('C10: user_b cannot access ORG_A conversations', async ({ page }) => {
  await page.goto('/inbox');
  // User B should only see ORG_B contacts (Cliente B1, Cliente B2)
  await expect(page.getByRole('heading', { name: 'Cliente B1' })).toBeVisible({ timeout: 10_000 });
  // ORG_A contacts must NOT appear
  const orgAContact = page.getByRole('heading', { name: 'Cliente A1' });
  await expect(orgAContact).not.toBeVisible();
});

test('C10: user_b cannot access ORG_A deals in funil', async ({ page }) => {
  await page.goto('/funil');
  // Funil should render without error for user_b
  await expect(page.getByRole('heading', { name: /funil|pipeline/i }).first()).toBeVisible({ timeout: 10_000 });
  // ORG_A deal titles must NOT appear
  const orgADeal = page.getByText('Venda A1');
  await expect(orgADeal).not.toBeVisible();
});