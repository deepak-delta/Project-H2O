import { expect, test } from '@playwright/test';
import { setupSupplier } from './helpers';

// iOS only honours overscroll-behavior on the element that scrolls — <html> here. Set anywhere
// else, pulling past the end of a page bounces the screen and opens a gap above the bottom nav.
test('the page does not rubber-band past its ends', async ({ page }) => {
  await page.goto('/login');
  const overscroll = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { x: style.overscrollBehaviorX, y: style.overscrollBehaviorY };
  });
  expect(overscroll).toEqual({ x: 'none', y: 'none' });
});

// Browsers (Chrome, Safari) slide their toolbars in and out when the PAGE scrolls, dragging a
// fixed bottom bar along. The app must scroll inside its own box so the page never moves.
test('scrolling a long screen never scrolls the page, and the bottom bar stays at the bottom', async ({ page }) => {
  await setupSupplier(page.request);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  // Wait for the dashboard so there is something to scroll.
  await expect(page.getByText('With clients', { exact: true })).toBeVisible();
  const bottomGap = () => nav.evaluate((el) => window.innerHeight - el.getBoundingClientRect().bottom);

  expect(await bottomGap()).toBe(0);
  await page.mouse.move(195, 300);
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 2000);
      return page.evaluate(() => document.querySelector('[data-scroll-root]')?.scrollTop ?? 0);
    })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  expect(await bottomGap()).toBe(0);
});
