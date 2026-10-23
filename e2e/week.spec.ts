import { expect, test } from '@playwright/test';
import { addDays, zonedDateKey } from '@wd/shared';
import { api, expectNoHorizontalScroll, randomPhone, setupSupplier, watchForErrors } from './helpers';

test('orders: "This week" shows the next 7 days by day, with upcoming regular deliveries', async ({ page }) => {
  const assertNoErrors = watchForErrors(page);
  const { storeId, productId } = await setupSupplier(page.request);
  const today = zonedDateKey(new Date(), 'Asia/Kolkata');
  const lakshmi = await api<{ id: string }>(page.request, 'POST', '/api/stores', {
    name: 'Lakshmi Water Point',
    phone: randomPhone(),
    prices: [{ productId, price: '50' }],
  });
  const place = (id: string, quantity: number, deliveryDate?: string) =>
    api<{ orderNumber: number }>(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId: id, items: [{ productId, quantity }], ...(deliveryDate ? { deliveryDate } : {}) });
  const todays = await place(storeId, 3);
  const later = await place(storeId, 8, addDays(today, 2));
  // Lakshmi gets 5 cans every day from tomorrow: those orders aren't made yet.
  await api(page.request, 'PUT', `/api/stores/${lakshmi.id}/schedule`, { frequency: 'DAILY', startDate: addDays(today, 1), items: [{ productId, quantity: 5 }] });

  // Pending is unchanged: just the orders.
  await page.goto('/orders?tab=open');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Sri Ganesh Stores/ })).toHaveCount(2);
  await expect(page.getByText('Lakshmi Water Point')).toHaveCount(0);

  await page.getByRole('radio', { name: 'This week' }).click();
  const todaySection = page.getByRole('region', { name: /^Today/ });
  await expect(todaySection).toContainText('1 delivery · 3 cans');
  await expect(todaySection.getByRole('link', { name: new RegExp(`Sri Ganesh Stores.*#${todays.orderNumber}`) })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Tomorrow/ })).toContainText('Lakshmi Water Point');
  await expect(page.getByRole('region', { name: /^Tomorrow/ })).toContainText('Regular');
  const third = page.locator('section').nth(2);
  await expect(third).toContainText(`#${later.orderNumber}`);
  await expect(third).toContainText('2 deliveries · 13 cans');
  await expect(page.getByRole('region')).toHaveCount(7);
  await expectNoHorizontalScroll(page);

  // Search narrows the week to one client.
  await page.getByRole('searchbox').fill('laksh');
  await expect(page.getByText('Sri Ganesh Stores')).toHaveCount(0);
  await expect(page.getByText('Lakshmi Water Point')).toHaveCount(6);

  // A regular delivery opens that client's schedule.
  await page.getByRole('searchbox').fill('');
  await page.getByRole('region', { name: /^Tomorrow/ }).getByRole('link', { name: /Lakshmi Water Point/ }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${lakshmi.id}/schedule`));
  assertNoErrors();
});
