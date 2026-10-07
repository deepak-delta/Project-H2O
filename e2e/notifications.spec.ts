import { expect, test } from '@playwright/test';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../playwright.config';
import { setupSupplier, watchForErrors } from './helpers';

async function subscriptionCount(phone: string): Promise<number> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM "PushSubscription" s JOIN "User" u ON u.id = s."userId" WHERE u.phone = $1',
    [phone],
  );
  await client.end();
  return Number(rows[0]?.n ?? 0);
}

/**
 * Test browsers can't reach Google's/Apple's push services, so the browser side of push is
 * replaced by a stand-in: permission is granted and subscribe() returns a fake subscription.
 * Everything of ours — the screen, the service-worker lookup, the API and storage — is real.
 */
function fakeBrowserPush() {
  let current: PushSubscription | null = null;
  Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
  Notification.requestPermission = () => Promise.resolve('granted');
  const make = (): PushSubscription =>
    ({
      endpoint: `https://push.example.test/${Math.random().toString(36).slice(2)}`,
      toJSON: () => ({ endpoint: current?.endpoint, keys: { p256dh: 'BFakeP256dhKeyForTestsOnly000', auth: 'fakeAuthSecret00' } }),
      unsubscribe: () => {
        current = null;
        return Promise.resolve(true);
      },
    }) as unknown as PushSubscription;
  PushManager.prototype.getSubscription = () => Promise.resolve(current);
  PushManager.prototype.subscribe = () => {
    current = make();
    return Promise.resolve(current);
  };
}

test('turn notifications on and off for this phone', async ({ page, context }) => {
  await context.addInitScript(fakeBrowserPush);
  const { phone } = await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);

  // The service worker (which receives pushes) must be installed first.
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await page.goto('/settings/notifications');
  await expect(page.getByText('Off for this phone', { exact: true })).toBeVisible();
  await expect(page.getByText('New orders from clients')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(page.getByText('On for this phone', { exact: true })).toBeVisible();
  await expect.poll(() => subscriptionCount(`+91${phone}`)).toBe(1);

  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('Off for this phone', { exact: true })).toBeVisible();
  await expect.poll(() => subscriptionCount(`+91${phone}`)).toBe(0);

  assertNoErrors();
});
