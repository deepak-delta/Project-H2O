import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalScroll, PIN, randomPhone, watchForErrors } from './helpers';

// Stock below zero: say why in plain words and fix it in one tap, instead of a bare minus number.
test('filled cans below zero: explained, and a pre-filled refill puts them right', async ({ page }) => {
  await api(page.request, 'POST', '/api/auth/signup', { businessName: 'Aqua Fresh', ownerName: 'Ravi', phone: randomPhone(), pin: PIN });
  const product = await api<{ id: string }>(page.request, 'POST', '/api/products', { name: '20L can', isReturnable: true });
  const store = await api<{ id: string }>(page.request, 'POST', '/api/stores', { name: 'Sri Ganesh', prices: [{ productId: product.id, price: '40' }] });
  // 10 starting cans; 16 go out over two days and 12 empties come back, but no refill is recorded.
  await api(page.request, 'POST', '/api/inventory/movements', { kind: 'OPENING', clientId: crypto.randomUUID(), productId: product.id, filled: 10, empty: 0 });
  for (const [qty, back] of [[8, 6], [8, 6]]) {
    await api(page.request, 'POST', '/api/orders/quick-sale', {
      clientId: crypto.randomUUID(),
      storeId: store.id,
      items: [{ productId: product.id, quantity: qty, emptyCollected: back }],
      payment: { amount: '0', method: 'CASH' },
    });
  }
  const assertNoErrors = watchForErrors(page);

  await page.goto('/inventory');
  await expect(page.getByText('6 more filled cans went out than the app knows you had.')).toBeVisible();
  await expect(page.getByText(/empties you refilled at the plant/)).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Record refill of 6 empties' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: /Cans/i }).or(sheet.getByRole('spinbutton')).first()).toHaveValue('6');
  await sheet.getByRole('button', { name: /Save/ }).click();

  await expect(page.getByText(/more filled cans went out/)).toHaveCount(0);
  const stock = await api<{ filled: number; empty: number }[]>(page.request, 'GET', '/api/inventory');
  expect(stock[0]).toMatchObject({ filled: 0, empty: 6 });
  assertNoErrors();
});

test('damaged cans: the count can be corrected (e.g. some thrown away)', async ({ page }) => {
  await api(page.request, 'POST', '/api/auth/signup', { businessName: 'Aqua Fresh', ownerName: 'Ravi', phone: randomPhone(), pin: PIN });
  const product = await api<{ id: string }>(page.request, 'POST', '/api/products', { name: '20L can', isReturnable: true });
  await api(page.request, 'POST', '/api/inventory/movements', { kind: 'OPENING', clientId: crypto.randomUUID(), productId: product.id, filled: 50, empty: 20 });
  await api(page.request, 'POST', '/api/inventory/movements', { kind: 'DAMAGE', clientId: crypto.randomUUID(), productId: product.id, from: 'EMPTY', quantity: 5 });
  const assertNoErrors = watchForErrors(page);

  await page.goto('/inventory');
  await expect(page.getByText('Damaged', { exact: true }).first().locator('..')).toContainText('5');
  await page.getByRole('button', { name: 'Correct count' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('App says 5. Thrown away? Count only the ones still here.')).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Damaged cans counted' }).fill('2');
  await sheet.getByLabel('Reason').fill('Threw away 3 broken cans');
  await expectNoHorizontalScroll(page);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByText('damaged 5 → 2 (−3)', { exact: false })).toBeVisible();
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Stock updated.')).toBeVisible();

  await expect(page.getByText('Damaged', { exact: true }).first().locator('..')).toContainText('2');
  const stock = await api<{ filled: number; empty: number; damaged: number }[]>(page.request, 'GET', '/api/inventory');
  expect(stock[0]).toMatchObject({ filled: 50, empty: 15, damaged: 2 });
  assertNoErrors();
});
