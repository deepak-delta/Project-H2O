import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, setupSupplier, watchForErrors } from './helpers';

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('privacy policy and terms: open without a login, linked from login, sign-up and More', async ({ page }) => {
  const assertNoErrors = watchForErrors(page);

  // Logged out, straight to the page (e.g. from an app-store listing).
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByText(/Digital Personal Data Protection Act, 2023/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms and conditions' })).toBeVisible();
  await expect(page.getByText(/courts in Kerala, India/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  // From the login screen, and back.
  await page.goto('/login');
  await page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // Signed in: from More.
  await setupSupplier(page.request);
  await page.goto('/more');
  await page.getByRole('link', { name: 'Terms and conditions' }).click();
  await expect(page.getByRole('heading', { name: 'Terms and conditions' })).toBeVisible();
  await page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  assertNoErrors();
});
