import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Builds the user guide: runs the app like the end-to-end tests do (same servers, same
 * throwaway database), fills it with a demo business, takes phone screenshots of every screen,
 * then prints docs/user-guide/guide.html to PDF.  Run: npm run docs:guide
 */
export default defineConfig({
  ...base,
  testDir: './docs/user-guide',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  projects: [
    {
      name: 'user-guide',
      testMatch: /\.spec\.ts$/,
      use: { ...base.use, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, actionTimeout: 15_000 },
    },
  ],
});
