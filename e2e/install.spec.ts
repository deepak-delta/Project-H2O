import { expect, test } from '@playwright/test';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_WHATSAPP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

test.describe('iPhone', () => {
  test.use({ userAgent: IPHONE_SAFARI });

  test('signup shows the Add to Home Screen steps once, until dismissed', async ({ page }) => {
    await page.goto('/signup');
    const sheet = page.getByRole('dialog', { name: 'Install the app' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Add to Home Screen')).toBeVisible();
    await sheet.getByRole('button', { name: 'Got it' }).click();
    await expect(sheet).toBeHidden();

    // Dismissed: not asked again on the next visit.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(sheet).toBeHidden();
  });
});

test.describe('iPhone in-app browser', () => {
  test.use({ userAgent: IPHONE_WHATSAPP });

  test('asks to open in Safari first', async ({ page }) => {
    await page.goto('/login');
    const sheet = page.getByRole('dialog', { name: 'Install the app' });
    await expect(sheet.getByText('Open in Safari')).toBeVisible();
  });
});

test('Android: one tap opens the browser install dialog', async ({ page }) => {
  await page.goto('/signup');
  // Stand-in for Chrome deciding the app is installable.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    event.prompt = () => {
      (window as unknown as { __prompted: boolean }).__prompted = true;
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  const sheet = page.getByRole('dialog', { name: 'Install the app' });
  await sheet.getByRole('button', { name: 'Install app' }).click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
});
