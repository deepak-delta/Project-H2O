import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Prints guide.html (with the screenshots taken by capture.spec.ts) to the user-guide PDF. */

const DIR = import.meta.dirname;
const OUT = path.join(DIR, 'Water-Delivery-User-Guide.pdf');

test('print the guide to PDF', async ({ browser }) => {
  // A plain desktop page: the guide is laid out for A4, not for a phone.
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(DIR, 'guide.html')).href);

  // Every screenshot the guide uses must exist and load.
  const missing = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
  expect(missing).toEqual([]);

  const edition = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  await page.evaluate((date) => {
    document.body.innerHTML = document.body.innerHTML.replace('{{DATE}}', date);
  }, edition);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));

  await page.pdf({
    path: OUT,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `
      <div style="width:100%;font:8px Helvetica,Arial,sans-serif;color:#6b7280;padding:0 15mm;display:flex;justify-content:space-between">
        <span>Water Delivery · User guide</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
    outline: true,
    tagged: true,
  });
  expect(existsSync(OUT)).toBe(true);
  await context.close();
});
