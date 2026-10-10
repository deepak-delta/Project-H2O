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

// Broken cans handed back: out of the client's count, into Damaged stock, and paid for by the client.
test('damaged cans taken back at a delivery leave the client and are charged to them', async ({ page }) => {
  const { storeId } = await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);
  await page.goto(`/stores/${storeId}`);
  const cansCard = page.getByText('Cans with client').locator('../..');
  const before = Number((await cansCard.innerText()).match(/\d+/)?.[0] ?? 0);

  // Deliver 4 at ₹50; 1 empty and 2 broken cans come back, ₹150 each.
  await page.getByRole('link', { name: 'Order', exact: true }).click();
  await page.getByRole('textbox', { name: '20L can' }).first().fill('4');
  await page.getByRole('textbox', { name: '20L can' }).nth(1).fill('1');
  // Tucked away until needed.
  await expect(page.getByRole('textbox', { name: 'Damaged 20L can' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Some cans came back damaged' }).click();
  await page.getByRole('textbox', { name: 'Damaged 20L can' }).fill('2');
  const confirm = page.getByRole('button', { name: /Confirm delivery/ });
  // The charge must be entered.
  await confirm.click();
  await expect(page.getByRole('alert')).toContainText('Enter what the client pays for each damaged 20L can');
  await page.getByLabel('Charge per damaged 20L can').fill('150');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expect(page.getByText('Includes 2 damaged cans')).toBeVisible();
  // ₹200 for the cans + ₹300 for the broken ones.
  await expect(confirm).toContainText('₹500');
  await page.getByRole('radio', { name: 'Credit' }).click();
  await confirm.click();
  await expect(page.getByText('Damaged cans (2)')).toBeVisible();

  await page.getByRole('button', { name: 'View client' }).click();
  await expect(cansCard).toContainText(String(before + 4 - 1 - 2));
  await expect(page.getByText('Balance', { exact: true }).locator('..')).toContainText('₹500');
  await expect(page.getByText(/2 damaged 20L can/)).toBeVisible();
  await page.getByRole('radio', { name: 'Cans' }).click();
  await expect(page.getByText(/Damaged cans taken back/)).toBeVisible();

  const stock = await api<{ productName: string; damaged: number }[]>(page.request, 'GET', '/api/inventory');
  expect(stock.find((p) => p.productName === '20L can')?.damaged).toBe(2);
  assertNoErrors();
});
