import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/admin_a.json' });

// C9 — ANALYTICS: relatorios page renders with seeded data
test('C9: analytics page loads and shows deal metrics', async ({ page }) => {
  await page.goto('/relatorios');
  // Page should render without error; look for any metrics heading or card
  await expect(page.getByRole('heading', { name: /relat|metric|dashboard/i }).first()).toBeVisible({ timeout: 10_000 });
});

// C5/C6 — COMPROVANTE + PAGAMENTO NA ENTREGA: verify no false evidence badges
test('C5-C6: no false payment evidence in closed conversations', async ({ page }) => {
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Encerradas 1' }).click();
  await expect(page.getByRole('heading', { name: 'Cliente A3' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('heading', { name: 'Cliente A3' }).click();
  await expect(page.getByText('Paguei PIX')).toBeVisible({ timeout: 10_000 });
  // No PAYMENT_EVIDENCE_RECEIVED badge for text-only messages
  const evidenceBadge = page.getByText(/PAYMENT_EVIDENCE_RECEIVED|evidência visual/i);
  await expect(evidenceBadge).not.toBeVisible();
});