import { expect, test } from '@playwright/test';
import { setupSupplier, watchForErrors } from './helpers';

/**
 * Face ID / fingerprint login, using Chromium's virtual platform authenticator
 * (a built-in "fingerprint reader" that always verifies the user).
 */
test('turn on biometric login, log out, and log back in with it', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await setupSupplier(page.request);
  const assertNoErrors = watchForErrors(page);
  await page.goto('/');

  // Offered once after a PIN login.
  await expect(page.getByText('Log in faster')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/login is on for this device/)).toBeVisible();
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0]?.isResidentCredential).toBe(true);

  // Log out, then log in with the fingerprint — no phone number or PIN typed.
  await page.goto('/more');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: /^Log in with / }).click();
  await expect(page.getByText('Aqua Fresh')).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  assertNoErrors();
});
