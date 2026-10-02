import { expect, test } from '@playwright/test';
import { securityHeaders } from '../scripts/security-headers.mjs';
import { setupSupplier } from './helpers';

/**
 * The production host sends a strict Content-Security-Policy (no inline scripts or styles).
 * Serve every page with the exact same headers and make sure nothing gets blocked.
 */
test('the app runs under the production security headers', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...securityHeaders } });
  });
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/.test(msg.text())) violations.push(msg.text());
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  const { storeId } = await setupSupplier(page.request);
  for (const url of ['/', `/orders/new?storeId=${storeId}`, `/stores/${storeId}`, '/inventory', '/reports/sales', '/cashflow']) {
    await page.goto(url);
    await expect(page.locator('main')).toBeVisible();
  }
  // The service worker and manifest load under the policy too.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true))).toBe(true);
  expect(violations).toEqual([]);
});
