import { expect, test, type Page } from '@playwright/test';
import { api, enterPin, expectNoHorizontalScroll, randomPhone, setupSupplier, watchForErrors } from './helpers';

async function skipBiometricOffer(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
}

/** A finger pulling the screen down from near the top, as on a phone. */
async function pullToRefresh(page: Page) {
  await page.evaluate(() => {
    const target = document.querySelector('[data-scroll-root] main') ?? document.body;
    const touch = (y: number) => new Touch({ identifier: 1, target, clientX: 180, clientY: y });
    const fire = (type: string, y: number | null) =>
      target.dispatchEvent(
        new TouchEvent(type, { bubbles: true, cancelable: true, touches: y === null ? [] : [touch(y)], changedTouches: [touch(y ?? 300)] }),
      );
    fire('touchstart', 120);
    fire('touchmove', 200);
    fire('touchmove', 300);
    fire('touchend', null);
  });
}

test('who owes money: search letter by letter, and a reminder listing every unpaid bill', async ({ page }) => {
  const assertNoErrors = watchForErrors(page);
  const { storeId, productId } = await setupSupplier(page.request);
  const lakshmi = await api<{ id: string }>(page.request, 'POST', '/api/stores', {
    name: 'Lakshmi Water Point',
    ownerName: 'Lakshmi',
    phone: randomPhone(),
    prices: [{ productId, price: '50' }],
  });
  const credit = (id: string, quantity: number) =>
    api(page.request, 'POST', '/api/orders/quick-sale', { clientId: crypto.randomUUID(), storeId: id, items: [{ productId, quantity }], payment: { amount: '0', method: 'CASH' } });
  await credit(storeId, 10); // #1 ₹500
  await credit(storeId, 4); // #2 ₹200
  await api(page.request, 'POST', '/api/payments', { clientId: crypto.randomUUID(), storeId, amount: '300', method: 'CASH' }); // pays most of #1
  await credit(lakshmi.id, 2); // #3 ₹100

  await page.goto('/reports/outstanding');
  await expect(page.getByRole('heading', { name: 'Who owes money' })).toBeVisible();
  const rows = page.getByRole('link', { name: /Sri Ganesh Stores|Lakshmi Water Point/ });
  await expect(rows).toHaveCount(2);

  const search = page.getByRole('searchbox');
  await search.pressSequentially('la');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Lakshmi Water Point/ })).toBeVisible();
  await search.fill('');
  await search.pressSequentially('gan');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Sri Ganesh Stores/ })).toBeVisible();
  await search.fill('zzz');
  await expect(page.getByText('No client found')).toBeVisible();
  await search.fill('');

  // A–Z puts Lakshmi first; Most owed puts Ganesh (₹400) first.
  await page.getByRole('radio', { name: 'A–Z' }).click();
  await expect(rows.first()).toContainText('Lakshmi');
  await page.getByRole('radio', { name: 'Most owed' }).click();
  await expect(rows.first()).toContainText('Sri Ganesh');
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Send Sri Ganesh Stores a payment reminder on WhatsApp' }).click();
  const message = page.getByLabel('Reminder message');
  await expect(message).toContainText('Hello Ganesh, this is Aqua Fresh.');
  await expect(message).toContainText('Order #1 · 10 cans · ₹200 (₹500 bill, part paid)');
  await expect(message).toContainText('Order #2 · 4 cans · ₹200');
  await expect(message).toContainText('Total due: ₹400');
  const href = await page.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
  expect(decodeURIComponent(href ?? '')).toContain('Order #2 · 4 cans · ₹200');
  await expectNoHorizontalScroll(page);
  assertNoErrors();
});

test('client location: owner pastes a Maps link, staff open it from their deliveries', async ({ page, browser }) => {
  const assertNoErrors = watchForErrors(page);
  const { storeId, productId } = await setupSupplier(page.request);
  const link = 'https://maps.app.goo.gl/Xy12AbCdEf';

  await page.goto(`/stores/${storeId}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit client' })).toBeVisible();
  const location = page.getByLabel('Location (optional)');
  await location.fill('https://example.com/not-a-map');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Paste a Google Maps link (Maps → Share → Copy link)')).toBeVisible();
  await location.fill(`Sri Ganesh Stores ${link}`);
  await page.getByLabel('Address (optional)').fill('12 Temple Street');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', link);
  await expect(page.getByText('12 Temple Street')).toBeVisible();

  const staffPhone = randomPhone();
  const staff = await api<{ id: string }>(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: staffPhone, pin: '246810' });
  await api(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity: 3 }], assignedToId: staff.id });

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  const assertNoStaffErrors = watchForErrors(phone);
  await phone.goto('/login');
  await phone.getByLabel('Phone number').fill(staffPhone);
  await enterPin(phone, '6-digit PIN', '246810');
  await expect(phone.getByRole('heading', { name: 'Hi Raju' })).toBeVisible();
  await skipBiometricOffer(phone);
  await expect(phone.getByRole('link', { name: 'Open Sri Ganesh Stores in Maps' })).toHaveAttribute('href', link);
  await expect(phone.getByRole('link', { name: /Sri Ganesh Stores.*12 Temple Street/ })).toBeVisible();
  await expectNoHorizontalScroll(phone);

  await phone.getByRole('link', { name: /Sri Ganesh Stores.*3 cans/ }).click();
  await expect(phone.getByText('Deliver to')).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', link);
  await expectNoHorizontalScroll(phone);
  assertNoStaffErrors();
  assertNoErrors();
});

test('screens stay current: staff see a new order by themselves, a client pulls down to refresh', async ({ page, browser }) => {
  const { storeId, productId } = await setupSupplier(page.request);
  const staffPhone = randomPhone();
  const staff = await api<{ id: string }>(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: staffPhone, pin: '246810' });

  const staffPage = await (await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  const assertNoStaffErrors = watchForErrors(staffPage);
  await staffPage.goto('/login');
  await staffPage.getByLabel('Phone number').fill(staffPhone);
  await enterPin(staffPage, '6-digit PIN', '246810');
  await expect(staffPage.getByRole('heading', { name: 'Hi Raju' })).toBeVisible();
  await skipBiometricOffer(staffPage);
  await expect(staffPage.getByText('No orders waiting for you.')).toBeVisible();

  // The owner gives them an order; it shows up without touching the phone.
  await api(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity: 7 }], assignedToId: staff.id });
  await expect(staffPage.getByRole('link', { name: /Sri Ganesh Stores.*7 cans/ })).toBeVisible({ timeout: 25_000 });
  assertNoStaffErrors();

  // The client's phone: owner records a delivery, the client pulls down and sees it at once.
  const storePhone = randomPhone();
  await api(page.request, 'PUT', `/api/stores/${storeId}/login`, { phone: storePhone, pin: '246802' });
  const client = await (await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  const assertNoClientErrors = watchForErrors(client);
  await client.goto('/login');
  await client.getByLabel('Phone number').fill(storePhone);
  await enterPin(client, '6-digit PIN', '246802');
  await expect(client.getByRole('link', { name: 'Order water' })).toBeVisible();
  await skipBiometricOffer(client);
  await expect(client.getByText('Owes ₹')).toHaveCount(0);

  await api(page.request, 'POST', '/api/orders/quick-sale', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity: 2 }], payment: { amount: '0', method: 'CASH' } });
  await pullToRefresh(client);
  await expect(client.getByText('Owes ₹100')).toBeVisible({ timeout: 5_000 });
  assertNoClientErrors();
});
