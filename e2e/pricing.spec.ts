import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalScroll, setupSupplier, watchForErrors } from './helpers';

test('a product the store has no price for asks for it once, on the first delivery', async ({ page }) => {
  const { storeId } = await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);
  const crate = await api<{ id: string }>(page.request, 'POST', '/api/products', { name: 'Bottle crate', isReturnable: false });
  await api(page.request, 'POST', '/api/inventory/movements', { kind: 'OPENING', clientId: crypto.randomUUID(), productId: crate.id, filled: 20, empty: 0 });

  await page.goto(`/orders/new?storeId=${storeId}`);
  await expect(page.getByText('No price for this store yet')).toBeVisible();
  await page.getByRole('textbox', { name: 'Bottle crate' }).fill('2');
  await page.getByRole('button', { name: /Confirm delivery/ }).click();
  await expect(page.getByText("Enter this store's price for Bottle crate.")).toBeVisible();

  await page.getByLabel('Price per Bottle crate for this store').fill('120');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: /Confirm delivery · ₹240/ }).click();
  await expect(page.getByText(/Order #1 · Sri Ganesh Stores/)).toBeVisible();

  // Saved for the store: the next order shows it as the price.
  await page.goto(`/orders/new?storeId=${storeId}`);
  await expect(page.getByText('₹120 each')).toBeVisible();
  assertNoErrors();
});
