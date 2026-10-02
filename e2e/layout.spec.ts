import { expect, test } from '@playwright/test';

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
