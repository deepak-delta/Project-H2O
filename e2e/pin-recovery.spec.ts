import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { readFileSync } from 'node:fs';
import { enterPin, expectNoHorizontalScroll, PIN, setupSupplier, watchForErrors } from './helpers';

/** What an authenticator app would show for this setup key (the next code, so it's never a repeat). */
const codeFor = (key: string, offsetSeconds = 0) =>
  new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(key.replace(/\s/g, '')) }).generate({
    timestamp: Date.now() + offsetSeconds * 1000,
  });

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('set up PIN recovery with an authenticator app, then reset a forgotten PIN with a recovery code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { phone } = await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);

  // ── Set up, from Login & security ──
  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'PIN recovery' })).toBeVisible();
  await page.getByRole('link', { name: 'Set up PIN recovery' }).click();
  await enterPin(page, /^Your current PIN$/, PIN);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Everything needed for manual setup on the same phone.
  await expect(page.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute('href', /^otpauth:\/\/totp\//);
  const details = page.locator('dl');
  await expect(details.getByText('Water Delivery', { exact: true })).toBeVisible();
  await expect(details.getByText('Time-based', { exact: true })).toBeVisible();
  await expect(details.getByText(/^\d{5} \d{5}$/)).toBeVisible(); // account name: the phone number
  const keyText = page.locator('[data-setup-key]');
  const key = (await keyText.innerText()).trim();
  expect(key).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
  await page.getByRole('button', { name: 'Copy setup key' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key.replace(/ /g, ''));
  await page.getByRole('button', { name: 'Hide setup key' }).click();
  await expect(keyText).not.toContainText(key.slice(0, 4));
  await page.getByRole('button', { name: 'Show setup key' }).click();
  await page.getByRole('button', { name: /Show QR code/ }).click();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  // The app reloads while the user is in their authenticator (common on iPhone): coming back goes
  // straight to the code, with the same key.
  await page.reload();
  await expect(page.getByText(/Finish setting up/)).toBeVisible();
  await page.getByRole('button', { name: 'Show the setup key again' }).click();
  await enterPin(page, /^Your current PIN$/, PIN);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-setup-key]')).toHaveText(key);
  await page.reload();
  await expect(page.getByText(/Finish setting up/)).toBeVisible();

  // A wrong code is refused; the real one switches recovery on.
  await page.getByLabel('Code from your authenticator app').fill('000000');
  await page.getByRole('button', { name: 'Verify and turn on' }).click();
  await expect(page.getByText(/That code didn't work/)).toBeVisible();
  await page.getByLabel('Code from your authenticator app').fill(codeFor(key));
  await page.getByRole('button', { name: 'Verify and turn on' }).click();

  // Recovery codes, shown once: download, then confirm they're saved.
  const codes = page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  const firstCode = (await codes.first().innerText()).trim();
  expect(firstCode).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  expect(readFileSync(await (await download).path(), 'utf8')).toContain(firstCode);
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
  await page.getByLabel("I've saved my recovery codes somewhere safe").check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('10 recovery codes left')).toBeVisible();
  assertNoErrors();

  // ── Forgot PIN, signed out ──
  await context.clearCookies();
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot PIN?' }).click();
  // The page loads on demand: wait for it, so typing doesn't land in the login form.
  await expect(page.getByRole('heading', { name: 'Forgot your PIN?' })).toBeVisible();
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter a code' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  await page.getByLabel('6-digit code from your authenticator app').fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Codes change every 30 seconds/)).toBeVisible();

  await page.getByRole('radio', { name: 'Recovery code' }).click();
  await page.getByLabel('One of your recovery codes').fill(firstCode.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Choose a new PIN' })).toBeVisible();
  await enterPin(page, /^New PIN$/, PIN);
  await enterPin(page, /^Type it again$/, PIN);
  await page.getByRole('button', { name: 'Save new PIN' }).click();
  await expect(page.getByText(/different PIN|not the one you had before/i)).toBeVisible();

  await enterPin(page, /^New PIN$/, '864209');
  await page.getByRole('button', { name: 'Show New PIN' }).click();
  await expect(page.getByRole('button', { name: 'Hide New PIN' })).toBeVisible();
  await enterPin(page, /^Type it again$/, '864209');
  await page.getByRole('button', { name: 'Save new PIN' }).click();
  await expect(page.getByRole('heading', { name: 'PIN changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Log in' }).click();

  // The old PIN no longer works; the new one does.
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Phone number').fill(phone);
  await enterPin(page, '6-digit PIN', PIN);
  await expect(page.getByText('Phone number or PIN is incorrect.')).toBeVisible();
  await enterPin(page, '6-digit PIN', '864209');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Aqua Fresh').first()).toBeVisible();
  assertNoErrors();
});
