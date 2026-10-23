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

test('orders: choose several and give them to staff in one go', async ({ page }) => {
  const assertNoErrors = watchForErrors(page);
  const { storeId, productId } = await setupSupplier(page.request);
  const today = zonedDateKey(new Date(), 'Asia/Kolkata');
  await api(page.request, 'POST', '/api/staff', { name: 'Raju Kumar', phone: randomPhone(), pin: '246810' });
  const place = (quantity: number, deliveryDate?: string) =>
    api<{ id: string; orderNumber: number }>(page.request, 'POST', '/api/orders', { clientId: crypto.randomUUID(), storeId, items: [{ productId, quantity }], ...(deliveryDate ? { deliveryDate } : {}) });
  const a = await place(3);
  const b = await place(4);
  const c = await place(6, addDays(today, 2));
  const assignedTo = async (id: string) => (await api<{ assignedTo: { name: string } | null }>(page.request, 'GET', `/api/orders/${id}`)).assignedTo?.name ?? null;

  // Pending: tick two, give them to Raju.
  await page.goto('/orders?tab=open');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose orders' })).toBeDisabled();
  await page.getByRole('button', { name: new RegExp(`#${a.orderNumber} ·`) }).click();
  await page.getByRole('button', { name: new RegExp(`#${b.orderNumber} ·`) }).click();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Give 2 to staff' }).click();
  await page.getByRole('dialog', { name: 'Give 2 orders to' }).getByRole('button', { name: /Raju Kumar/ }).click();
  await expect(page.getByText("2 orders given to Raju Kumar. They've been told.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  expect([await assignedTo(a.id), await assignedTo(b.id), await assignedTo(c.id)]).toEqual(['Raju Kumar', 'Raju Kumar', null]);

  // This week: choose a whole day with its Select, then take everything back.
  await page.getByRole('radio', { name: 'This week' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('section').nth(2).getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Give 1 to staff' }).click();
  await page.getByRole('dialog', { name: 'Give 1 order to' }).getByRole('button', { name: /Raju Kumar/ }).click();
  await expect(page.getByText("1 order given to Raju Kumar. They've been told.")).toBeVisible();
  expect(await assignedTo(c.id)).toBe('Raju Kumar');

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Give 3 to staff' }).click();
  await page.getByRole('dialog', { name: 'Give 3 orders to' }).getByRole('button', { name: /Me \(owner\)/ }).click();
  await expect(page.getByText('3 orders back with you.')).toBeVisible();
  expect([await assignedTo(a.id), await assignedTo(b.id), await assignedTo(c.id)]).toEqual([null, null, null]);
  assertNoErrors();
});
