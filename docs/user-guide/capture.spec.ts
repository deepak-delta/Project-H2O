import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { api, PIN } from '../../e2e/helpers';
import { BASE_URL } from '../../playwright.config';

/**
 * Fills the app with a demo water business and photographs every screen for the user guide.
 * Screens are taken at 390×844 (a common phone), 2× for sharp printing.
 */

const OUT = path.join(import.meta.dirname, 'screenshots');
mkdirSync(OUT, { recursive: true });

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, baseURL: BASE_URL, locale: 'en-IN', timezoneId: 'Asia/Kolkata' };
const STAFF_PIN = '246810';
const CLIENT_PIN = '135790';
const OWNER_PHONE = '9846012345';
const RAJU_PHONE = '9846022222';
const SURESH_PHONE = '9846033333';
const CLIENT_LOGIN_PHONE = '9846044444';

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 85 });
}

/** Phone context with the one-time "install" and "use fingerprint" offers already answered. */
async function phone(browser: Browser, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ ...PHONE, ...extra });
  await context.addInitScript(() => {
    localStorage.setItem('wd-install-dismissed-at', String(Date.now()));
    localStorage.setItem('wd.biometricPromptDismissed', '1');
  });
  return context;
}

const uuid = () => crypto.randomUUID();
const daysAgo = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setUTCHours(hour - 5, 30, 0, 0); // hour:00 in India
  return d.toISOString();
};

interface Demo {
  can: string;
  crate: string;
  clients: Record<string, string>;
  raju: string;
  suresh: string;
  pendingForRaju: string;
  orderForLater: string;
}

async function login(request: APIRequestContext, phoneNumber: string, pin: string) {
  await api(request, 'POST', '/api/auth/login', { phone: phoneNumber, pin });
}

async function seed(owner: APIRequestContext, staffRequest: (phone: string) => Promise<APIRequestContext>): Promise<Demo> {
  await api(owner, 'POST', '/api/auth/signup', { businessName: 'Aqua Fresh Water Supply', ownerName: 'Ravi Kumar', phone: OWNER_PHONE, pin: PIN });
  const can = (await api<{ id: string }>(owner, 'POST', '/api/products', { name: '20L can', capacityLiters: '20', isReturnable: true, depositAmount: '150' })).id;
  const crate = (await api<{ id: string }>(owner, 'POST', '/api/products', { name: '1L bottle crate', isReturnable: false })).id;
  await api(owner, 'POST', '/api/inventory/movements', { kind: 'OPENING', clientId: uuid(), productId: can, filled: 900, empty: 40 });
  await api(owner, 'POST', '/api/inventory/movements', { kind: 'OPENING', clientId: uuid(), productId: crate, filled: 90, empty: 0 });

  const clientList: [string, Record<string, unknown>][] = [
    ['Sri Ganesh Stores', { category: 'STORE', ownerName: 'Ganesh', phone: '9847011111', address: 'MG Road, Kochi', prices: [{ productId: can, price: '40' }, { productId: crate, price: '120' }], openingCans: [{ productId: can, quantity: 6 }], openingBalance: '350' }],
    ['Hotel Saravana Bhavan', { category: 'STORE', ownerName: 'Murugan', phone: '9847022222', prices: [{ productId: can, price: '38' }, { productId: crate, price: '115' }] }],
    ['Anitha Menon', { category: 'HOME', phone: '9847033333', address: 'Flat 4B, Palm Grove', prices: [{ productId: can, price: '45' }, { productId: crate, price: '120' }] }],
    ['City Care Hospital', { category: 'OTHER', categoryOther: 'Hospital', ownerName: 'Admin office', phone: '9847044444', creditLimit: '5000', prices: [{ productId: can, price: '36' }, { productId: crate, price: '110' }] }],
    ['Lakshmi Bakery', { category: 'STORE', ownerName: 'Lakshmi', phone: '9847055555', prices: [{ productId: can, price: '40' }, { productId: crate, price: '120' }] }],
    ['Joseph Thomas', { category: 'INDIVIDUAL', phone: '9847066666', prices: [{ productId: can, price: '45' }, { productId: crate, price: '120' }] }],
    ['Green Valley Apartments', { category: 'OTHER', categoryOther: 'Apartment', ownerName: 'Secretary', phone: '9847077777', prices: [{ productId: can, price: '35' }, { productId: crate, price: '120' }] }],
    ['Fresh Mart Supermarket', { category: 'STORE', ownerName: 'Shaji', phone: '9847088888', prices: [{ productId: can, price: '38' }, { productId: crate, price: '118' }] }],
  ];
  const clients: Record<string, string> = {};
  for (const [name, body] of clientList) clients[name] = (await api<{ id: string }>(owner, 'POST', '/api/stores', { name, ...body })).id;

  const raju = (await api<{ id: string }>(owner, 'POST', '/api/staff', { name: 'Raju', phone: RAJU_PHONE, pin: STAFF_PIN })).id;
  const suresh = (await api<{ id: string }>(owner, 'POST', '/api/staff', { name: 'Suresh', phone: SURESH_PHONE, pin: STAFF_PIN })).id;
  const rajuApi = await staffRequest(RAJU_PHONE);
  const sureshApi = await staffRequest(SURESH_PHONE);

  // Three and a half weeks of everyday business.
  const names = Object.keys(clients);
  const who = [owner, rajuApi, sureshApi];
  for (let day = 24; day >= 1; day--) {
    for (let k = 0; k < 4; k++) {
      const name = names[(day * 3 + k) % names.length]!;
      const qty = 2 + ((day + k) % 6);
      const pay = (day * 2 + k + 1) % 3; // 0 credit, 1 part, 2 full
      const price = name === 'Anitha Menon' || name === 'Joseph Thomas' ? 45 : 38;
      await api(who[(day + k) % 3]!, 'POST', '/api/orders/quick-sale', {
        clientId: uuid(),
        storeId: clients[name],
        items: [{ productId: can, quantity: qty, emptyCollected: Math.max(0, qty - 1 - (k % 2)) }],
        payment: { amount: pay === 0 ? '0' : String(pay === 1 ? Math.round((qty * price) / 2) : qty * price), method: k % 2 ? 'UPI' : 'CASH' },
        occurredAt: daysAgo(day, 9 + k),
      });
    }
    if (day % 6 === 0) {
      await api(rajuApi, 'POST', '/api/payments', { clientId: uuid(), storeId: clients['City Care Hospital'], amount: '500', method: 'BANK_TRANSFER', occurredAt: daysAgo(day, 16) });
    }
  }
  for (const [day, category, amount, method] of [
    [20, 'SALARY', '12000', 'BANK_TRANSFER'],
    [15, 'ELECTRICITY', '1850', 'UPI'],
    [9, 'VEHICLE', '2400', 'CASH'],
    [5, 'WATER_PURCHASE', '6500', 'BANK_TRANSFER'],
    [2, 'MAINTENANCE', '650', 'CASH'],
  ] as const) {
    await api(owner, 'POST', '/api/cashflow', { clientId: uuid(), type: 'EXPENSE', category, amount, method, date: new Date(daysAgo(day)).toISOString().slice(0, 10) });
  }

  // Today.
  await api(rajuApi, 'POST', '/api/orders/quick-sale', {
    clientId: uuid(),
    storeId: clients['Sri Ganesh Stores'],
    items: [
      { productId: can, quantity: 8, emptyCollected: 5, damagedCollected: 1, damageChargeEach: '150' },
      { productId: crate, quantity: 2 },
    ],
    payment: { amount: '300', method: 'CASH' },
  });
  await api(rajuApi, 'POST', '/api/orders/quick-sale', {
    clientId: uuid(),
    storeId: clients['Hotel Saravana Bhavan'],
    items: [{ productId: can, quantity: 12, emptyCollected: 12 }],
    payment: { amount: '456', method: 'UPI' },
  });
  await api(sureshApi, 'POST', '/api/orders/quick-sale', {
    clientId: uuid(),
    storeId: clients['Anitha Menon'],
    items: [{ productId: can, quantity: 2, emptyCollected: 2 }],
    payment: { amount: '90', method: 'CASH' },
  });
  await api(rajuApi, 'POST', '/api/payments', { clientId: uuid(), storeId: clients['Lakshmi Bakery'], amount: '200', method: 'CASH' });
  await api(rajuApi, 'POST', '/api/stores/' + clients['Fresh Mart Supermarket'] + '/can-returns', { clientId: uuid(), items: [{ productId: can, quantity: 3 }] });
  await api(rajuApi, 'POST', '/api/cashflow', { clientId: uuid(), type: 'EXPENSE', category: 'FUEL', amount: '450', method: 'CASH', description: 'Van diesel' });
  await api(owner, 'POST', '/api/inventory/movements', { kind: 'REFILL', clientId: uuid(), productId: can, quantity: 40 });

  // Work waiting: an order for Raju today, one for tomorrow, and one placed by a client in their app.
  const pendingForRaju = (await api<{ id: string }>(owner, 'POST', '/api/orders', { clientId: uuid(), storeId: clients['City Care Hospital'], items: [{ productId: can, quantity: 15 }, { productId: crate, quantity: 3 }], assignedToId: raju })).id;
  const tomorrow = new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const orderForLater = (await api<{ id: string }>(owner, 'POST', '/api/orders', { clientId: uuid(), storeId: clients['Green Valley Apartments'], items: [{ productId: can, quantity: 20 }], assignedToId: suresh, deliveryDate: tomorrow })).id;

  // App access for one client, who then orders water themselves.
  await api(owner, 'PUT', `/api/stores/${clients['Sri Ganesh Stores']}/login`, { phone: CLIENT_LOGIN_PHONE, pin: CLIENT_PIN });

  await rajuApi.dispose();
  await sureshApi.dispose();
  return { can, crate, clients, raju, suresh, pendingForRaju, orderForLater };
}

test('capture every screen', async ({ browser, playwright }) => {
  // ── Before signing in ────────────────────────────────────────────────────
  {
    const iphone = await browser.newContext({
      ...PHONE,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    });
    const page = await iphone.newPage();
    await page.goto('/signup');
    await expect(page.getByRole('dialog', { name: 'Install the app' })).toBeVisible();
    await shot(page, 'start-install-iphone');
    await iphone.close();

    const fresh = await phone(browser);
    const p = await fresh.newPage();
    await p.goto('/signup');
    await expect(p.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
    await shot(p, 'start-signup');
    await p.goto('/login');
    await shot(p, 'start-login');
    await fresh.close();
  }

  // ── Demo business ────────────────────────────────────────────────────────
  const ownerContext = await phone(browser);
  const owner = await ownerContext.newPage();
  const extra: APIRequestContext[] = [];
  const demo = await seed(owner.request, async (phoneNumber) => {
    const r = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
    await login(r, phoneNumber, STAFF_PIN);
    extra.push(r);
    return r;
  });
  const ganesh = demo.clients['Sri Ganesh Stores']!;

  // ── Owner ────────────────────────────────────────────────────────────────
  await owner.goto('/');
  await expect(owner.getByText('Today', { exact: false }).first()).toBeVisible();
  await shot(owner, 'owner-home');
  await owner.locator('[data-scroll-root]').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(owner, 'owner-home-more');

  // New delivery, step by step.
  await owner.goto('/orders/new');
  await shot(owner, 'owner-new-pick-client');
  await owner.getByRole('button', { name: /Lakshmi Bakery/ }).first().click().catch(async () => owner.getByText('Lakshmi Bakery').first().click());
  await owner.getByRole('textbox', { name: '20L can' }).first().fill('6');
  await shot(owner, 'owner-new-quantities');
  await owner.getByRole('textbox', { name: '20L can' }).nth(1).fill('4');
  await owner.getByRole('button', { name: 'Some cans came back damaged' }).click();
  await owner.getByRole('textbox', { name: 'Damaged 20L can' }).fill('1');
  await owner.getByLabel('Charge per damaged 20L can').fill('150');
  await owner.getByText('Damaged cans taken back').scrollIntoViewIfNeeded();
  await shot(owner, 'owner-new-empties-damaged');
  await owner.getByRole('radio', { name: 'Part paid' }).click();
  await owner.getByLabel('Amount received').fill('200');
  await owner.getByText('Client balance after').scrollIntoViewIfNeeded();
  await shot(owner, 'owner-new-payment');
  await owner.getByRole('button', { name: /Confirm delivery/ }).click();
  await expect(owner.getByText(/Order #\d+/)).toBeVisible();
  await shot(owner, 'owner-new-done');

  // An order for later, given to staff.
  await owner.goto('/orders/new');
  await owner.getByText('Joseph Thomas').first().click();
  await owner.getByRole('radio', { name: 'For later' }).click();
  await shot(owner, 'owner-new-for-later');

  await owner.goto('/orders');
  await shot(owner, 'owner-orders');
  await owner.goto(`/orders/${demo.pendingForRaju}`);
  await shot(owner, 'owner-order-detail');

  // Clients.
  await owner.goto('/stores');
  await shot(owner, 'owner-clients');
  await owner.goto('/stores?filter=owes');
  await shot(owner, 'owner-clients-owe');
  await owner.goto('/stores/new');
  await owner.getByLabel('Client name').fill('Royal Juice Centre');
  await shot(owner, 'owner-client-add');
  await owner.locator('[data-scroll-root]').evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
  await shot(owner, 'owner-client-add-more');

  await owner.goto(`/stores/${ganesh}`);
  await shot(owner, 'owner-client-page');
  await owner.getByRole('radio', { name: 'Money' }).scrollIntoViewIfNeeded();
  await owner.getByRole('radio', { name: 'Money' }).click();
  await shot(owner, 'owner-client-money-history');
  await owner.getByRole('radio', { name: 'Cans' }).click();
  await shot(owner, 'owner-client-can-history');
  await owner.locator('[data-scroll-root]').evaluate((el) => el.scrollTo(0, 0));
  await owner.getByRole('button', { name: 'Payment', exact: true }).first().click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-client-record-payment');
  await owner.keyboard.press('Escape');
  await owner.goto(`/stores/${ganesh}`);
  await owner.getByRole('button', { name: 'Empties', exact: true }).first().click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-client-collect-empties');
  await owner.goto(`/stores/${ganesh}`);
  await owner.getByRole('button', { name: 'Correct', exact: true }).first().click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-client-correct-cans');
  await owner.goto(`/stores/${ganesh}`);
  await owner.getByText('Client app').first().scrollIntoViewIfNeeded();
  await shot(owner, 'owner-client-app-access');

  // Stock.
  await owner.goto('/inventory');
  await shot(owner, 'owner-inventory');
  await owner.getByRole('button', { name: 'Add stock' }).first().click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-inventory-add-stock');
  await owner.goto('/inventory');
  await owner.getByRole('button', { name: 'Damaged / lost' }).first().click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-inventory-damaged');
  await owner.goto('/inventory/holders');
  await shot(owner, 'owner-cans-with-clients');

  // Money.
  await owner.goto('/payments');
  await shot(owner, 'owner-payments');
  await owner.goto('/cashflow');
  await shot(owner, 'owner-cashflow');
  await owner.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-cashflow-add-expense');

  // Reports.
  await owner.goto('/reports');
  await shot(owner, 'owner-reports');
  await owner.goto('/reports/summary');
  await expect(owner.getByText('This period', { exact: true })).toBeVisible();
  await shot(owner, 'owner-report-summary');
  await owner.getByText('Owner and staff').scrollIntoViewIfNeeded();
  await shot(owner, 'owner-report-summary-more');
  await owner.goto('/reports/sales');
  await shot(owner, 'owner-report-daily');
  await owner.goto('/reports/sales?groupBy=month');
  await shot(owner, 'owner-report-monthly');
  await owner.goto('/reports/outstanding');
  await shot(owner, 'owner-report-outstanding');
  await owner.goto('/reports/inventory');
  await shot(owner, 'owner-report-stock');
  await owner.goto('/reports/payments');
  await shot(owner, 'owner-report-payments');

  // Business settings.
  await owner.goto('/more');
  await shot(owner, 'owner-more');
  await owner.goto('/products');
  await shot(owner, 'owner-products');
  await owner.goto('/staff');
  await shot(owner, 'owner-staff');
  await owner.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(owner.getByRole('dialog')).toBeVisible();
  await shot(owner, 'owner-staff-add');
  await owner.goto(`/staff/${demo.raju}`);
  await shot(owner, 'owner-staff-day');
  await owner.goto('/settings/security');
  await shot(owner, 'owner-security');
  await owner.goto('/sync');
  await shot(owner, 'owner-sync');
  await ownerContext.close();

  // ── Staff (Raju) ─────────────────────────────────────────────────────────
  {
    const context = await phone(browser);
    const page = await context.newPage();
    await login(page.request, RAJU_PHONE, STAFF_PIN);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Hi Raju' })).toBeVisible();
    await shot(page, 'staff-home');
    await page.locator('[data-scroll-root]').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot(page, 'staff-home-activity');
    await page.goto(`/orders/${demo.pendingForRaju}/deliver`);
    await shot(page, 'staff-deliver-order');
    await page.goto('/orders/new');
    await shot(page, 'staff-new-delivery');
    await page.goto('/stores');
    await shot(page, 'staff-clients');
    await page.goto(`/stores/${ganesh}`);
    await shot(page, 'staff-client-page');
    await page.goto('/expenses');
    await shot(page, 'staff-expenses');
    await page.goto('/more');
    await shot(page, 'staff-more');
    await context.close();
  }

  // ── Client app (Sri Ganesh Stores) ───────────────────────────────────────
  {
    const context = await phone(browser);
    const page = await context.newPage();
    await login(page.request, CLIENT_LOGIN_PHONE, CLIENT_PIN);
    await page.goto('/');
    await shot(page, 'client-home');
    await page.goto('/orders/new');
    await shot(page, 'client-order-water');
    await page.goto('/orders');
    await shot(page, 'client-orders');
    await page.goto('/payments');
    await shot(page, 'client-payments');
    await page.goto('/statement');
    await shot(page, 'client-statement');
    await page.goto('/account');
    await shot(page, 'client-account');
    await context.close();
  }

  for (const r of extra) await r.dispose();
});
