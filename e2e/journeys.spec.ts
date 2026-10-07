import { expect, test, type Page } from '@playwright/test';
import { api, enterPin, expectNoHorizontalScroll, randomPhone, setupSupplier, watchForErrors } from './helpers';

/** Dismiss the one-time "use fingerprint" offer if this browser shows it. */
async function skipBiometricOffer(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
}

test.describe('supplier journey', () => {
  test('sign up → set up → store → deliver with empties and part payment → collect payment → stock and ledger add up', async ({ page }) => {
    const assertNoErrors = watchForErrors(page);

    // Sign up (two short steps).
    await page.goto('/signup');
    await page.getByLabel('Business name').fill('Aqua Fresh Water');
    await page.getByLabel('Your name').fill('Ravi Kumar');
    await page.getByLabel('Phone number').fill(randomPhone());
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await enterPin(page, 'New 6-digit PIN');
    await enterPin(page, 'Enter the PIN again');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Onboarding: first product, then opening stock.
    await expect(page.getByText("Let's set up your business")).toBeVisible();
    await skipBiometricOffer(page);
    // No price here: each store gets its own price when it is added.
    await expect(page.getByLabel('Price per can')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add product' }).click();
    await page.getByRole('textbox', { name: 'Filled cans' }).fill('100');
    await page.getByRole('textbox', { name: 'Empty cans' }).fill('20');
    await page.getByRole('button', { name: 'Save stock' }).click();
    await expect(page.getByText('Add your first client')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // A store that already owes ₹300 from the paper notebook.
    await page.getByRole('link', { name: 'Add client' }).click();
    await page.getByLabel('Client name').fill('Sri Ganesh Stores');
    await page.getByLabel('Owner name (optional)').fill('Ganesh');
    await page.getByLabel('Phone (optional)').fill(randomPhone());
    // This store's price is required: saving without it is refused.
    await page.getByRole('button', { name: 'Add client' }).click();
    await expect(page.getByText("Enter this client's price").first()).toBeVisible();
    await page.getByLabel('Price per 20L water can').fill('50');
    await page.getByRole('button', { name: /Already supplying this client/ }).click();
    await page.getByLabel('Amount they owe now').fill('300');
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Add client' }).click();
    await expect(page.getByText('Owes ₹300').first()).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Deliver 10 cans, collect 7 empties, ₹200 paid by UPI.
    await page.getByRole('link', { name: 'Order', exact: true }).click();
    const cans = page.getByRole('textbox', { name: '20L water can' });
    await cans.first().fill('10');
    await cans.nth(1).fill('7');
    await page.getByRole('radio', { name: 'Part paid' }).click();
    await page.getByLabel('Amount received').fill('200');
    await page.getByRole('radio', { name: 'UPI' }).click();
    await expect(page.getByText('Owes ₹600')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: /Confirm delivery · ₹500/ }).click();

    await expect(page.getByText(/Order #1 · Sri Ganesh Stores/)).toBeVisible();
    await expect(page.getByText('Owes ₹600')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Collect ₹200 more against the balance.
    await page.getByRole('button', { name: 'View client' }).click();
    await page.getByRole('button', { name: 'Payment' }).click();
    await page.getByLabel('Amount received').fill('200');
    await page.getByRole('button', { name: 'Save payment' }).click();
    await expect(page.getByText(/received\. New balance ₹400/)).toBeVisible();
    await expect(page.getByText('Owes ₹400').first()).toBeVisible();
    // Ledger: opening 300 → +500 → −200 → −200 = 400, and the store holds 3 cans.
    await expect(page.getByText('balance ₹800')).toBeVisible();
    await expect(page.getByText('Cans with client').locator('..')).toContainText('3');

    // Inventory: 100 − 10 filled, 20 + 7 empty, 3 with stores.
    await page.goto('/inventory');
    const card = page.locator('div', { hasText: /^20L water can/ }).first();
    await expect(card).toBeVisible();
    await expect(page.getByText('Filled', { exact: true }).locator('..')).toContainText('90');
    await expect(page.getByText('Empty', { exact: true }).locator('..')).toContainText('27');
    await expect(page.getByText('With clients', { exact: true }).first().locator('..')).toContainText('3');
    await expectNoHorizontalScroll(page);

    // Dashboard totals.
    await page.goto('/');
    await expect(page.getByText('Sales', { exact: true }).locator('..')).toContainText('₹500');
    await expect(page.getByText('Collected today').locator('..')).toContainText('₹400');
    await expect(page.getByText('Outstanding with clients').locator('..')).toContainText('₹400');
    await expectNoHorizontalScroll(page);

    assertNoErrors();
  });
});

test.describe('store journey', () => {
  test('log in → order water → see the order, balance and payments', async ({ page, request }) => {
    // Supplier side via the API (its own cookie jar): a delivery that leaves ₹300 owed, then app access.
    const supplier = await setupSupplier(request);
    await api(request, 'POST', '/api/orders/quick-sale', {
      clientId: crypto.randomUUID(),
      storeId: supplier.storeId,
      items: [{ productId: supplier.productId, quantity: 10, emptyCollected: 0 }],
      payment: { amount: '200', method: 'CASH' },
    });
    const storePhone = randomPhone();
    await api(request, 'PUT', `/api/stores/${supplier.storeId}/login`, { phone: storePhone, pin: '246802' });

    const assertNoErrors = watchForErrors(page);
    await page.goto('/login');
    await page.getByLabel('Phone number').fill(storePhone);
    await expectNoHorizontalScroll(page);
    await enterPin(page, '6-digit PIN', '246802'); // submits by itself on the 6th digit

    await expect(page.getByRole('link', { name: 'Order water' })).toBeVisible();
    await expect(page.getByText('Owes ₹300')).toBeVisible();
    await expect(page.getByText('Cans with you').locator('..')).toContainText('10');
    await skipBiometricOffer(page);
    await expectNoHorizontalScroll(page);

    // Prefilled with the last delivery; just pick the day and send.
    await page.getByRole('link', { name: 'Order water' }).click();
    await expect(page.getByRole('textbox', { name: '20L can' })).toHaveValue('10');
    await page.getByRole('radio', { name: 'Tomorrow' }).click();
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: /Send order · 10 cans/ }).click();
    await expect(page.getByText(/Order #2 sent/)).toBeVisible();

    await page.getByRole('button', { name: 'View order' }).click();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText('Estimated total')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Balance statement and payments.
    await page.goto('/statement');
    await expect(page.getByText('Delivery #1')).toBeVisible();
    await expect(page.getByText('balance ₹300').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('link', { name: 'Payments' }).click();
    await expect(page.getByText('₹200')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Supplier-only screens are not reachable.
    await page.goto('/stores');
    await expect(page.getByText("This page doesn't exist")).toBeVisible();

    assertNoErrors();
  });
});
