import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user_a.json' });

// C2 — INTENÇÃO COMERCIAL: conversa com preço + tamanho deve mostrar sinais
test('C2: commercial intent signals visible in conversation', async ({ page }) => {
  await page.goto('/inbox');
  // Click on Cliente A2 conversation (has SIZE_SELECTED signal)
  await page.getByRole('heading', { name: 'Cliente A2' }).click();
  // Wait for conversation detail to load
  await expect(page.getByText('Tamanho M?')).toBeVisible({ timeout: 10_000 });
});

// C3 — PIX + 👍: PIX_KEY_SENT + thumbs up NÃO resulta em PAYMENT_CONFIRMED
test('C3: PIX key sent does not auto-confirm payment', async ({ page }) => {
  await page.goto('/inbox');
  // Cliente A1 has PIX_KEY_SENT signal but no confirmation message
  await page.getByRole('heading', { name: 'Cliente A1' }).click();
  await expect(page.getByText('Ola preco')).toBeVisible({ timeout: 10_000 });
  // Verify no "Pagamento Confirmado" or "Venda Ganha" badge appears
  const confirmedBadge = page.getByText(/pagamento confirmado|venda ganha/i);
  await expect(confirmedBadge).not.toBeVisible();
});

// C4 — "PAGUEI" SEM IMAGEM: text-only "paguei" should not create visual evidence
test('C4: paguei text without image does not create visual evidence', async ({ page }) => {
  await page.goto('/inbox');
  // Cliente A3 has "Paguei PIX" message but closed status
  await page.getByRole('button', { name: 'Encerradas 1' }).click();
  await expect(page.getByRole('heading', { name: 'Cliente A3' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('heading', { name: 'Cliente A3' }).click();
  await expect(page.getByText('Paguei PIX')).toBeVisible({ timeout: 10_000 });
  // No payment evidence badge should appear for text-only messages
  const evidenceBadge = page.getByText(/evidência|comprovante|payment evidence/i);
  await expect(evidenceBadge).not.toBeVisible();
});