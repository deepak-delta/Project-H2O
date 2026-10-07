import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, randomPhone, setupSupplier } from './helpers';

/** Fails on serious or critical WCAG 2.1 A/AA problems (contrast, labels, roles, names…). */
async function expectAccessible(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(serious, `accessibility problems on ${what}`).toEqual([]);
}

test('public screens', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expectAccessible(page, 'login');
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
  await expectAccessible(page, 'signup');
});

test('supplier screens', async ({ page }) => {
  const { storeId, productId } = await setupSupplier(page.request);
  await api(page.request, 'POST', '/api/orders/quick-sale', {
    clientId: crypto.randomUUID(),
    storeId,
    items: [{ productId, quantity: 5, emptyCollected: 2 }],
    payment: { amount: '100', method: 'UPI' },
  });

  const screens: [string, string, RegExp | string][] = [
    ['home', '/', 'Today'],
    ['new order', `/orders/new?storeId=${storeId}`, 'Delivered'],
    ['orders', '/orders?tab=all', 'Orders'],
    ['clients', '/stores', 'Clients'],
    ['store ledger', `/stores/${storeId}`, 'Balance'],
    ['inventory', '/inventory', 'Inventory'],
    ['reports', '/reports', 'Reports'],
    ['sales report', '/reports/sales', 'Daily sales'],
    ['cash flow', '/cashflow', 'Cash flow'],
    ['more', '/more', 'More'],
  ];
  for (const [what, url, marker] of screens) {
    await page.goto(url);
    await expect(page.getByText(marker).first()).toBeVisible();
    const notNow = page.getByRole('button', { name: 'Not now' });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    await expectAccessible(page, what);
  }
});

test('store screens', async ({ page, request }) => {
  const { storeId } = await setupSupplier(request);
  const phone = randomPhone();
  await api(request, 'PUT', `/api/stores/${storeId}/login`, { phone, pin: '246802' });
  await api(page.request, 'POST', '/api/auth/login', { phone, pin: '246802' });

  for (const [what, url, marker] of [
    ['store home', '/', 'Order water'],
    ['order water', '/orders/new', 'How many?'],
    ['statement', '/statement', 'Statement'],
    ['account', '/account', 'Account'],
  ] as const) {
    await page.goto(url);
    await expect(page.getByText(marker).first()).toBeVisible();
    const notNow = page.getByRole('button', { name: 'Not now' });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    await expectAccessible(page, what);
  }
});
