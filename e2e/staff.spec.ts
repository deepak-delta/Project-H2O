import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, enterPin, expectNoHorizontalScroll, randomPhone, setupSupplier, watchForErrors } from './helpers';

async function skipBiometricOffer(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('delivery staff: sees only their day, delivers the order given to them, hands over the right cash', async ({ page, browser }) => {
  const { storeId, productId } = await setupSupplier(page.request);

  // Owner: add a member of staff and give them a store's order.
  const staffPhone = randomPhone();
  const staff = await api<{ id: string }>(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: staffPhone, pin: '246810' });
  const order = await api<{ id: string; orderNumber: number }>(page.request, 'POST', '/api/orders', {
    clientId: crypto.randomUUID(),
    storeId,
    items: [{ productId, quantity: 4 }],
  });
  await api(page.request, 'POST', `/api/orders/${order.id}/assign`, { staffId: staff.id });
  // An order not given to them: they must not see it.
  await api(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity: 9 }] });

  // Staff logs in on their own phone.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  const assertNoErrors = watchForErrors(phone);
  await phone.goto('/login');
  await phone.getByLabel('Phone number').fill(staffPhone);
  await enterPin(phone, '6-digit PIN', '246810');
  await expect(phone.getByRole('heading', { name: 'Hi Raju' })).toBeVisible();
  await skipBiometricOffer(phone);
  await expect(phone.getByText('Cash to hand over')).toBeVisible();
  await expect(phone.getByRole('link', { name: /Sri Ganesh Stores.*#\d+ · 4 cans/ })).toBeVisible();
  await expect(phone.getByText('9 cans')).toHaveCount(0);
  await expectNoHorizontalScroll(phone);
  await expectAccessible(phone);

  // Deliver the order given to them, ₹200 cash.
  await phone.getByRole('link', { name: /Sri Ganesh Stores.*4 cans/ }).click();
  await phone.getByRole('radio', { name: 'Part paid' }).click();
  await phone.getByLabel('Amount received').fill('200');
  await phone.getByRole('button', { name: /Confirm delivery · ₹200/ }).click();
  await expect(phone.getByText(/Order #\d+ · Sri Ganesh Stores/)).toBeVisible();

  // Fuel ₹50 in cash.
  await phone.goto('/expenses');
  await phone.getByRole('button', { name: 'Add expense' }).click();
  await phone.getByRole('radio', { name: 'Fuel' }).click();
  await phone.getByLabel('Amount').fill('50');
  await phone.getByRole('button', { name: 'Save' }).click();
  await expect(phone.getByText('Spent today')).toBeVisible();

  // Today: one delivery, ₹200 taken, ₹50 spent → ₹150 to hand over. Nothing waiting.
  await phone.goto('/');
  await expect(phone.getByText('Cash to hand over').locator('..')).toContainText('₹150');
  await expect(phone.getByText('No orders waiting for you.')).toBeVisible();
  await expect(phone.getByText('Delivered 4 cans')).toBeVisible();

  // Store page: balance and actions, but no history, editing or app access.
  await phone.goto(`/stores/${storeId}`);
  await expect(phone.getByText('Balance', { exact: true })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Payment' })).toBeVisible();
  await expect(phone.getByRole('radio', { name: 'Money' })).toHaveCount(0);
  await expect(phone.getByLabel('Edit store')).toHaveCount(0);
  await expect(phone.getByText('Store app')).toHaveCount(0);
  await expectAccessible(phone);

  // Owner-only screens don't exist for staff.
  for (const path of ['/reports', '/inventory', '/cashflow', '/payments', '/stores/new', '/staff', '/products']) {
    await phone.goto(path);
    await expect(phone.getByText("This page doesn't exist"), path).toBeVisible();
  }
  assertNoErrors();

  // Owner sees what Raju spent today.
  await page.goto('/staff');
  await expect(page.getByRole('link', { name: /Raju Kumar/ })).toContainText('₹50');
  await expect(page.getByRole('link', { name: /Raju Kumar/ })).toContainText('staff expense');
});

test("the owner's dashboard updates by itself when staff deliver", async ({ page, browser }) => {
  const { storeId, productId } = await setupSupplier(page.request);
  const staffPhone = randomPhone();
  await api(page.request, 'POST', '/api/staff', { name: 'Mani', phone: staffPhone, pin: '246810' });

  await page.goto('/');
  const sales = page.getByText('Sales', { exact: true }).locator('..');
  await expect(sales).toContainText('₹0');

  // Staff delivers from their own phone; the owner's screen is left open, untouched.
  const staffSide = await browser.newContext();
  await staffSide.request.post('/api/auth/login', { data: { phone: staffPhone, pin: '246810' }, headers: { origin: 'http://localhost:4173' } });
  await api(staffSide.request, 'POST', '/api/orders/quick-sale', {
    clientId: crypto.randomUUID(),
    storeId,
    items: [{ productId, quantity: 3 }],
    payment: { amount: '150', method: 'CASH' },
  });

  // Within one check (every 10 seconds), with no reload.
  await expect(sales).toContainText('₹150', { timeout: 15_000 });
  await staffSide.close();
});
