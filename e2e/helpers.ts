import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PIN = '482913';
const ORIGIN = 'http://localhost:4173';

/** A random Indian mobile number, unique enough for parallel runs. */
export function randomPhone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** JSON request through the app's origin (the API rejects writes without a same-origin Origin). */
export async function api<T = unknown>(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(path, { method, data, headers: { origin: ORIGIN } });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export interface SupplierSetup {
  phone: string;
  storeId: string;
  productId: string;
}

/**
 * Supplier with a ₹50 returnable can (100 filled / 20 empty) and one store, created through the
 * API. Using `page.request` shares cookies with the browser, so the page is signed in too.
 */
export async function setupSupplier(request: APIRequestContext, opts: { businessName?: string } = {}): Promise<SupplierSetup> {
  const phone = randomPhone();
  await api(request, 'POST', '/api/auth/signup', { businessName: opts.businessName ?? 'Aqua Fresh', ownerName: 'Ravi Kumar', phone, pin: PIN });
  const product = await api<{ id: string }>(request, 'POST', '/api/products', { name: '20L can', sellingPrice: '50', isReturnable: true });
  await api(request, 'POST', '/api/inventory/movements', { kind: 'OPENING', clientId: crypto.randomUUID(), productId: product.id, filled: 100, empty: 20 });
  const store = await api<{ id: string }>(request, 'POST', '/api/stores', { name: 'Sri Ganesh Stores', ownerName: 'Ganesh', phone: randomPhone() });
  return { phone, storeId: store.id, productId: product.id };
}

/** Fails the test on JavaScript errors. Expected 4xx network noise (e.g. 401 before login) is ignored. */
export function watchForErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    // Requests the browser itself refuses while offline are expected in offline tests.
    if (/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return () => expect(errors, 'browser errors').toEqual([]);
}

/** No sideways scrolling: the page must fit the phone's width. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(0);
}

/** Types into a 6-digit PIN field (one real input drawn as boxes). */
export async function enterPin(page: Page, label: string | RegExp, pin = PIN): Promise<void> {
  await page.getByLabel(label).fill(pin);
}
