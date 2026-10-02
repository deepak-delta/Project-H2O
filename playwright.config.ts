import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * End-to-end tests run the production build (service worker included) against a real API and
 * a dedicated database that is wiped at the start of every run.
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@localhost:54329/wd_e2e';
const API_PORT = 3101;
const WEB_PORT = 4173;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

const phone = (width: number): NonNullable<PlaywrightTestConfig['use']> => ({
  viewport: { width, height: 800 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
  },
  projects: [
    // The two critical journeys at every target phone width.
    ...[360, 375, 390, 430].map((width) => ({ name: `phone-${width}`, testMatch: /journeys\.spec\.ts/, use: phone(width) })),
    // Biometrics, real offline mode and accessibility once, at a common width.
    { name: 'features-390', testMatch: /(biometric|offline|a11y|csp)\.spec\.ts/, use: phone(390) },
  ],
  webServer: [
    {
      command: 'npx tsx apps/api/src/server.ts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        PIN_PEPPER: 'e2e-only-pepper-not-a-secret',
        RATE_LIMIT_PER_MINUTE: '100000',
      },
    },
    {
      command: `npm run build -w @wd/web && npm run preview -w @wd/web -- --port ${WEB_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
