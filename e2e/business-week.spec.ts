import { expect, test, type Page } from '@playwright/test';
import { addDays, zonedDateKey } from '@wd/shared';
import { api, enterPin, expectNoHorizontalScroll, randomPhone, setupSupplier, watchForErrors } from './helpers';

async function skipBiometricOffer(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
}

async function login(page: Page, phone: string, pin: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await enterPin(page, '6-digit PIN', pin);
}

/**
 * A business week across all three roles, through the screens each person really uses, with
 * every money, can and stock total checked at the end. Owner: `page`. Staff and client: their
 * own phones (separate sign-ins).
 */
test('a business week: owner, staff and client together; money, cans and stock add up', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const ownerErrors = watchForErrors(page);
  const { storeId: ganeshId, productId } = await setupSupplier(page.request); // 100 filled, 20 empty; Ganesh ₹50/can
  const today = zonedDateKey(new Date(), 'Asia/Kolkata');

  // Lakshmi was already a customer in the paper notebook: owes ₹150 and has 4 of our cans.
  const lakshmi = await api<{ id: string }>(page.request, 'POST', '/api/stores', {
    name: 'Lakshmi Water Point',
    ownerName: 'Lakshmi',
    phone: randomPhone(),
    openingBalance: '150',
    openingCans: [{ productId, quantity: 4 }],
    prices: [{ productId, price: '50' }],
  });
  const staffPhone = randomPhone();
  await api(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: staffPhone, pin: '246810' });
  const place = (storeId: string, quantity: number, deliveryDate?: string) =>
    api<{ id: string; orderNumber: number }>(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity }], ...(deliveryDate ? { deliveryDate } : {}) });
  const forGanesh = await place(ganeshId, 10); // today
  const forLakshmi = await place(lakshmi.id, 6, addDays(today, 1)); // tomorrow

  // ── Staff phone: signs in and turns on notifications (registered on the server).
  const staffCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const staff = await staffCtx.newPage();
  const staffErrors = watchForErrors(staff);
  await login(staff, staffPhone, '246810');
  await expect(staff.getByRole('heading', { name: 'Hi Raju' })).toBeVisible();
  await skipBiometricOffer(staff);
  await staff.request.post('/api/push/subscribe', {
    data: { endpoint: 'https://push.example.com/raju-week', keys: { p256dh: 'BKeyKeyKeyKeyKeyKeyKey', auth: 'authauthauth' } },
    headers: { origin: 'http://localhost:4173' },
  });

  // ── Owner: gives both orders to Raju in one go.
  await page.goto('/orders?tab=open');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Give 2 to staff' }).click();
  await page.getByRole('dialog', { name: 'Give 2 orders to' }).getByRole('button', { name: /Raju Kumar/ }).click();
  await expect(page.getByText("2 orders given to Raju Kumar. They've been told.")).toBeVisible();
  await expect(page.getByText('Assigned to Raju Kumar')).toHaveCount(2);

  // ── Staff: today's order only (tomorrow's isn't on his list yet). Delivers 10, takes 6 empties, ₹300 cash.
  await staff.reload();
  await expect(staff.getByRole('link', { name: new RegExp(`Sri Ganesh Stores.*#${forGanesh.orderNumber} · 10 cans`) })).toBeVisible();
  await expect(staff.getByText(`#${forLakshmi.orderNumber}`)).toHaveCount(0);
  await staff.getByRole('link', { name: new RegExp(`Sri Ganesh Stores.*#${forGanesh.orderNumber}`) }).click();
  await staff.getByRole('textbox', { name: '20L can' }).nth(1).fill('6');
  await staff.getByRole('radio', { name: 'Part paid' }).click();
  await staff.getByLabel('Amount received').fill('300');
  await expectNoHorizontalScroll(staff);
  await staff.getByRole('button', { name: /Confirm delivery · ₹500/ }).click();
  await expect(staff.getByText(new RegExp(`Order #${forGanesh.orderNumber} · Sri Ganesh Stores`))).toBeVisible();
  // ₹50 diesel from the cash.
  await staff.goto('/expenses');
  await staff.getByRole('button', { name: 'Add expense' }).click();
  await staff.getByRole('radio', { name: 'Fuel' }).click();
  await staff.getByLabel('Amount').fill('50');
  await staff.getByRole('button', { name: 'Save' }).click();
  await expect(staff.getByText('Spent today')).toBeVisible();
  await staff.goto('/');
  await expect(staff.getByText('Cash to hand over').locator('..')).toContainText('₹250');

  // ── Client (Ganesh) on his phone: sees what he owes and holds, orders 5 cans for tomorrow.
  const clientPhone = randomPhone();
  await api(page.request, 'PUT', `/api/stores/${ganeshId}/login`, { phone: clientPhone, pin: '135790' });
  const clientCtx = await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
  const client = await clientCtx.newPage();
  const clientErrors = watchForErrors(client);
  await login(client, clientPhone, '135790');
  await expect(client.getByRole('link', { name: 'Order water' })).toBeVisible();
  await skipBiometricOffer(client);
  await expect(client.getByText('Owes ₹200')).toBeVisible();
  await expect(client.getByText('Cans with you').locator('..')).toContainText('4');
  await client.getByRole('link', { name: 'Order water' }).click();
  await client.getByRole('textbox', { name: '20L can' }).fill('5');
  await client.getByRole('radio', { name: 'Tomorrow' }).click();
  await client.getByRole('button', { name: /Send order · 5 cans/ }).click();
  await expect(client.getByText(/Order #\d+ sent/)).toBeVisible();
  const clientOrderNo = Number(/#(\d+)/.exec((await client.getByText(/Order #\d+ sent/).textContent()) ?? '')?.[1]);

  // ── Owner: accepts the client's order.
  await page.goto('/orders?tab=open');
  await page.getByRole('link', { name: new RegExp(`#${clientOrderNo} ·`) }).click();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

  // ── Owner: Lakshmi pays ₹100 by UPI against her old balance.
  await page.goto(`/stores/${lakshmi.id}`);
  await page.getByRole('button', { name: 'Payment' }).click();
  await page.getByLabel('Amount received').fill('100');
  await page.getByRole('radio', { name: 'UPI' }).click();
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/New balance ₹50/)).toBeVisible();

  // ── Owner: a delivery entered for the wrong shop is cancelled; everything goes back.
  const wrong = await api<{ order: { id: string } }>(page.request, 'POST', '/api/orders/quick-sale', {
    clientId: crypto.randomUUID(),
    storeId: lakshmi.id,
    items: [{ productId, quantity: 2 }],
    payment: { amount: '0', method: 'CASH' },
  });
  await page.goto(`/orders/${wrong.order.id}`);
  await page.getByRole('button', { name: 'Cancel delivery' }).click();
  const sheet = page.getByRole('dialog', { name: 'Cancel this delivery?' });
  await sheet.getByLabel('Reason (optional)').fill('Wrong shop');
  await sheet.getByRole('button', { name: 'Cancel delivery' }).click();
  await expect(page.getByText('Cancelled: Wrong shop')).toBeVisible();

  // ── Who owes money, and the reminders.
  await page.goto('/reports/outstanding');
  await expect(page.getByText('Total outstanding').locator('..')).toContainText('₹250');
  await page.getByRole('button', { name: 'Send Sri Ganesh Stores a payment reminder on WhatsApp' }).click();
  const msg = page.getByLabel('Reminder message');
  await expect(msg).toContainText(new RegExp(`Order #${forGanesh.orderNumber} · 10 cans\\s+Bill ₹500 · Paid ₹300 · Due ₹200`));
  await expect(msg).toContainText('Total due: ₹200');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Send Lakshmi Water Point a payment reminder on WhatsApp' }).click();
  await expect(msg).toContainText('Earlier balance: ₹150');
  await expect(msg).toContainText(/Paid on .+: −₹100/);
  await expect(msg).toContainText('Total due: ₹50');
  await expect(msg).not.toContainText('Wrong');
  await page.getByRole('button', { name: 'Close' }).click();

  // ── The week ahead: tomorrow has Lakshmi's (Raju) and Ganesh's own order (not assigned yet).
  await page.goto('/orders?tab=week');
  const tomorrow = page.getByRole('region', { name: /^Tomorrow/ });
  await expect(tomorrow).toContainText('2 deliveries · 11 cans');
  await expect(tomorrow.getByRole('link', { name: /Lakshmi Water Point.*Assigned to Raju Kumar/ })).toBeVisible();
  await expect(tomorrow.getByRole('link', { name: /Sri Ganesh Stores.*Not assigned yet/ })).toBeVisible();

  // ── Dashboard: sales ₹500 (the cancelled one nets out), ₹400 collected, ₹50 spent, ₹250 owed,
  // stock 100−10 filled, 20+6 empty, 4+4 cans with clients.
  await page.goto('/');
  await expect(page.getByText('Sales', { exact: true }).locator('..')).toContainText('₹500');
  await expect(page.getByText('Collected today').locator('..')).toContainText('₹400');
  await expect(page.getByText('Expenses today').locator('..')).toContainText('₹50');
  await expect(page.getByText('Net cash today').locator('..')).toContainText('₹350');
  await expect(page.getByText('Outstanding with clients').locator('..')).toContainText('₹250');
  await expect(page.getByText('Filled', { exact: true }).locator('..')).toContainText('90');
  await expect(page.getByText('Empty', { exact: true }).locator('..')).toContainText('26');
  await expect(page.getByText('With clients', { exact: true }).first().locator('..')).toContainText('8');
  await expectNoHorizontalScroll(page);

  // ── The client sees the same numbers.
  await client.goto('/');
  await expect(client.getByText('Owes ₹200')).toBeVisible();

  // ── And the server's own records agree.
  const ganesh = await api<{ balance: string; cansOutstanding: number }>(page.request, 'GET', `/api/stores/${ganeshId}`);
  const laks = await api<{ balance: string; cansOutstanding: number }>(page.request, 'GET', `/api/stores/${lakshmi.id}`);
  expect([ganesh.balance, ganesh.cansOutstanding, laks.balance, laks.cansOutstanding]).toEqual(['200.00', 4, '50.00', 4]);

  ownerErrors();
  staffErrors();
  clientErrors();
  await staffCtx.close();
  await clientCtx.close();
});
