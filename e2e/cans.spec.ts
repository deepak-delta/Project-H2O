import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalScroll, setupSupplier, watchForErrors } from './helpers';

// Cans with a client = cans they already had + full cans delivered − empties collected back.
test('cans already at a new client count, deliveries add, empties subtract, and the owner can correct it', async ({ page }) => {
  await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);

  await page.goto('/stores/new');
  await page.getByLabel('Client name').fill('Old Customer');
  await page.getByLabel('Price per 20L can').fill('50');
  // Asked up front, no hidden section.
  await expect(page.getByText('Cans already at this client')).toBeVisible();
  await page.getByRole('textbox', { name: '20L can', exact: true }).fill('20');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Add client' }).click();
  const cansCard = page.getByText('Cans with client').locator('../..');
  await expect(cansCard).toContainText('20');

  // Deliver 5, collect 3 empties: 20 + 5 − 3 = 22.
  await page.getByRole('link', { name: 'Order', exact: true }).click();
  const cans = page.getByRole('textbox', { name: '20L can' });
  await cans.first().fill('5');
  await cans.nth(1).fill('3');
  await page.getByRole('button', { name: /Confirm delivery/ }).click();
  await page.getByRole('button', { name: 'View client' }).click();
  await expect(cansCard).toContainText('22');

  // The real count is 18: correct it, with a confirm step.
  await page.getByRole('button', { name: 'Correct' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: '20L can' }).fill('18');
  await page.getByRole('button', { name: 'Review change' }).click();
  await expect(page.getByText('22 → 18')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(cansCard).toContainText('18');
  await expect(page.getByText('Cans at Old Customer set to 18.')).toBeVisible();

  // It shows in the client's can history as a correction.
  await page.getByRole('radio', { name: 'Cans' }).click();
  await expect(page.getByText(/corrected from 22 to 18/)).toBeVisible();
  const stores = await api<{ items: { name: string; cansOutstanding: number }[] }>(page.request, 'GET', '/api/stores?search=Old');
  expect(stores.items[0]?.cansOutstanding).toBe(18);
  assertNoErrors();
});
