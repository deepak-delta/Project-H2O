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
  await expect(phone.getByLabel('Edit client')).toHaveCount(0);
  await expect(phone.getByText('Client app')).toHaveCount(0);
  await expectAccessible(phone);

  // Nowhere to add a client: not on Clients, nor in New delivery when nobody matches.
  await phone.goto('/stores');
  await expect(phone.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await expect(phone.getByRole('link', { name: /^Add/ })).toHaveCount(0);
  await phone.goto('/orders/new');
  await phone.getByRole('searchbox').fill('zzz nobody');
  await expect(phone.getByText('No matching clients')).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Add client' })).toHaveCount(0);

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

test('owner adds an "Other" client, then creates an order for later and gives it to staff', async ({ page, browser }) => {
  await setupSupplier(page.request);
  const staffPhone = randomPhone();
  await api(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: staffPhone, pin: '246810' });
  const assertNoErrors = watchForErrors(page);

  // New client of type "Other: Office".
  await page.goto('/stores/new');
  await page.getByLabel('Client name').fill('Tech Park');
  await page.getByRole('radio', { name: 'Other' }).click();
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByText('Type what kind of client this is')).toBeVisible();
  await page.getByLabel('What kind of client?').fill('Office');
  await page.getByLabel('Price per 20L can').fill('45');
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('heading', { name: 'Tech Park' })).toBeVisible();
  await expect(page.getByText(/^Office/)).toBeVisible();

  // Order for later, given to Raju.
  await page.getByRole('link', { name: 'Order', exact: true }).click();
  await page.getByRole('radio', { name: 'For later' }).click();
  await page.getByRole('textbox', { name: '20L can' }).fill('5');
  await page.getByRole('radio', { name: 'Tomorrow' }).click();
  await page.getByLabel('Delivered by').selectOption({ label: 'Raju Kumar' });
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Give to Raju Kumar · 5 cans' }).click();
  await expect(page.getByText(/Order #\d+ · Tech Park/)).toBeVisible();
  // Raju hasn't turned on notifications on any phone, so the owner is told to call.
  await expect(page.getByText('Given to Raju Kumar. Their notifications are off, so call to tell them.')).toBeVisible();
  assertNoErrors();

  // Tomorrow's order isn't on Raju's list today; it shows on the owner's order as his.
  await page.getByRole('button', { name: 'View order' }).click();
  await expect(page.getByLabel('Assigned to')).toHaveValue(/.+/);
  await expect(page.getByText("Raju Kumar's notifications are off.", { exact: false })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

  // An order for today does show up for him.
  const staffSide = await browser.newContext();
  await staffSide.request.post('/api/auth/login', { data: { phone: staffPhone, pin: '246810' }, headers: { origin: 'http://localhost:4173' } });
  const before = await api<{ assignedOrders: unknown[] }>(staffSide.request, 'GET', '/api/staff/today');
  expect(before.assignedOrders).toHaveLength(0);
  await page.goto('/orders/new');
  await page.getByRole('button', { name: /Tech Park/ }).click();
  await page.getByRole('radio', { name: 'For later' }).click();
  await page.getByRole('textbox', { name: '20L can' }).fill('2');
  await page.getByLabel('Delivered by').selectOption({ label: 'Raju Kumar' });
  await page.getByRole('button', { name: 'Give to Raju Kumar · 2 cans' }).click();
  await expect(page.getByText('Given to Raju Kumar. Their notifications are off, so call to tell them.')).toBeVisible();
  const after = await api<{ assignedOrders: { storeName: string; totalQuantity: number }[] }>(staffSide.request, 'GET', '/api/staff/today');
  expect(after.assignedOrders).toEqual([expect.objectContaining({ storeName: 'Tech Park', totalQuantity: 2 })]);
  await staffSide.close();
});

test('the owner deletes a member of staff; their past work stays', async ({ page }) => {
  const { storeId, productId } = await setupSupplier(page.request);
  const staffPhone = randomPhone();
  const staff = await api<{ id: string }>(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: staffPhone, pin: '246810' });
  const order = await api<{ id: string }>(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity: 3 }], assignedToId: staff.id });
  const assertNoErrors = watchForErrors(page);

  await page.goto(`/staff/${staff.id}`);
  await page.getByRole('button', { name: 'Delete Raju Kumar' }).click();
  await expect(page.getByRole('dialog')).toContainText('Their past deliveries, payments and expenses stay in your records');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText('Raju Kumar deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Raju Kumar/ })).toHaveCount(0);

  // Their order came back unassigned, and the number is free for someone new.
  const back = await api<{ assignedTo: unknown }>(page.request, 'GET', `/api/orders/${order.id}`);
  expect(back.assignedTo).toBeNull();
  await api(page.request, 'POST', '/api/staff', { name: 'Suresh', phone: staffPhone, pin: '135790' });
  assertNoErrors();
});
