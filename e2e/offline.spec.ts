import { expect, test } from '@playwright/test';
import { api, setupSupplier, watchForErrors } from './helpers';

/**
 * Real offline mode (the browser's network is switched off, service worker included):
 * the installed app still opens, shows saved data, and a payment taken offline syncs once
 * when the connection returns.
 */
test('app opens offline and a payment taken offline syncs exactly once', async ({ page, context }) => {
  const { storeId } = await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);

  // First visit installs the service worker; the reload puts the page under its control.
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Open the store while online so it is saved on the device, and let the save happen.
  await page.goto(`/stores/${storeId}`);
  await expect(page.getByRole('heading', { name: 'Sri Ganesh Stores' })).toBeVisible();
  await page.waitForTimeout(1500);

  // Signal gone: the app still loads from the service worker and shows the saved store.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("You're offline. Showing saved information.")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sri Ganesh Stores' })).toBeVisible();

  // Take a payment offline.
  await page.getByRole('button', { name: 'Payment' }).click();
  await page.getByLabel('Amount received').fill('150');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/saved on this phone/).first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'waiting to sync' })).toBeVisible();

  // Back online: it syncs by itself.
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: /waiting to sync|Syncing/ })).toHaveCount(0, { timeout: 15_000 });

  const after = await api<{ balance: string }>(page.request, 'GET', `/api/stores/${storeId}`);
  const payments = await api<{ items: { amount: string }[] }>(page.request, 'GET', `/api/payments?storeId=${storeId}`);
  expect(payments.items.filter((p) => p.amount === '150.00')).toHaveLength(1);
  // A new store owed nothing, so the ₹150 shows as an advance.
  expect(after.balance).toBe('-150.00');

  assertNoErrors();
});
