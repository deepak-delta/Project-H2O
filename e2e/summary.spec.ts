import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { api, expectNoHorizontalScroll, setupSupplier, watchForErrors } from './helpers';

// One report with everything, for the last 7 days up to the last year.
test('business summary: everything in one report, for 7 days to 1 year, downloadable', async ({ page }) => {
  const { storeId, productId } = await setupSupplier(page.request);
  // 8 cans at ₹50, ₹150 cash now; ₹40 fuel.
  await api(page.request, 'POST', '/api/orders/quick-sale', {
    clientId: crypto.randomUUID(),
    storeId,
    items: [{ productId, quantity: 8, emptyCollected: 3 }],
    payment: { amount: '150', method: 'CASH' },
  });
  await api(page.request, 'POST', '/api/cashflow', { clientId: crypto.randomUUID(), type: 'EXPENSE', category: 'FUEL', amount: '40', method: 'CASH' });
  const assertNoErrors = watchForErrors(page);

  await page.goto('/reports');
  await page.getByRole('link', { name: /Business summary/ }).click();
  await expect(page.getByRole('heading', { name: 'Business summary' })).toBeVisible();

  const stat = (label: string) => page.getByText(label, { exact: true }).locator('..');
  await expect(stat('Sales')).toContainText('₹400');
  await expect(stat('Collected')).toContainText('₹150');
  await expect(stat('Change in dues')).toContainText('₹250');
  await expect(stat('Cans delivered')).toContainText('8');
  await expect(page.getByRole('link', { name: /Sri Ganesh Stores/ }).first()).toBeVisible();
  await expect(page.getByText('Fuel')).toBeVisible();
  await expect(stat('Owed to you')).toContainText('₹250');
  await expectNoHorizontalScroll(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // Every period works, and today's sale is in all of them.
  for (const label of ['7 days', '3 months', '1 year', '1 month']) {
    await page.getByRole('radio', { name: label }).click();
    await expect(page).toHaveURL(/period=/);
    await expect(stat('Sales')).toContainText('₹400');
  }

  // A PDF document of the same report.
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const pdfFile = await pdfDownload;
  expect(pdfFile.suggestedFilename()).toMatch(/^business-summary-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = readFileSync(await pdfFile.path());
  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  expect(pdf.toString('latin1')).toMatch(/\/Type \/Pages .* \/Count [12] >>/);

  // One CSV with every section.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const csv = readFileSync(await (await download).path(), 'utf8');
  for (const line of ['Sales,Sales,400.00', 'Sales,Collected,150.00', 'Expenses,Fuel,40.00', 'Cans,Empties collected,3', 'Right now,Owed to you,250.00', 'Top clients,Sri Ganesh Stores,400.00']) {
    expect(csv).toContain(line);
  }
  assertNoErrors();
});
