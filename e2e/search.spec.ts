import { expect, test } from '@playwright/test';
import { api, setupSupplier, watchForErrors } from './helpers';

test('client search narrows with every letter typed, on Clients and New order', async ({ page }) => {
  const { productId } = await setupSupplier(page.request); // has "Sri Ganesh Stores"
  for (const [name, category] of [
    ['Ganga Traders', 'STORE'],
    ['Gopal Home', 'HOME'],
    ['Lakshmi Bakery', 'STORE'],
  ]) {
    await api(page.request, 'POST', '/api/stores', { name, category, prices: [{ productId, price: '50' }] });
  }
  const assertNoErrors = watchForErrors(page);

  for (const path of ['/stores', '/orders/new']) {
    await page.goto(path);
    const box = page.getByPlaceholder('Client, owner or phone');
    const rows = page.getByRole(path === '/stores' ? 'link' : 'button', { name: /Ganesh|Ganga|Gopal|Lakshmi/ });
    await expect(rows).toHaveCount(4);

    await box.click();
    await page.keyboard.type('G');
    await expect(rows).toHaveCount(3); // Ganesh, Ganga, Gopal
    await page.keyboard.type('a');
    await expect(rows).toHaveCount(2); // Ganesh, Ganga
    await page.keyboard.type('nga');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Ganga Traders');

    // By client type.
    await box.fill('');
    await page.keyboard.type('hom');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Gopal Home');
  }
  assertNoErrors();
});
