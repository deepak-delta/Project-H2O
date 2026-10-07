import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Client } from './helpers';
import { signupSupplier } from './helpers';

export interface Business {
  client: Client;
  supplierId: string;
  canId: string;
  storeId: string;
}

export async function createProduct(
  client: Client,
  overrides: Partial<{ name: string; isReturnable: boolean }> = {},
): Promise<string> {
  const res = await client.post('/api/products', {
    name: '20L can',
    capacityLiters: '20',
    depositAmount: '0',
    isReturnable: true,
    ...overrides,
  });
  if (res.statusCode !== 201) throw new Error(`product: ${res.body}`);
  return res.json<{ id: string }>().id;
}

/** A store priced at ₹50 for every product on sale, unless `prices` is given. */
export async function createStore(client: Client, body: Record<string, unknown> = {}): Promise<string> {
  const products = (await client.get('/api/products')).json<{ id: string }[]>();
  const prices = products.map((p) => ({ productId: p.id, price: '50' }));
  const res = await client.post('/api/stores', { name: 'Sri Ganesh Stores', ownerName: 'Ganesh', phone: '9811122233', prices, ...body });
  if (res.statusCode !== 201) throw new Error(`store: ${res.body}`);
  return res.json<{ id: string }>().id;
}

/** Sets what one store pays for one product. */
export async function setPrice(client: Client, storeId: string, productId: string, price: string): Promise<void> {
  const res = await client.request('PUT', `/api/stores/${storeId}/prices`, { prices: [{ productId, price }] });
  if (res.statusCode !== 200) throw new Error(`price: ${res.body}`);
}

export async function addStock(client: Client, productId: string, filled: number, empty = 0): Promise<void> {
  const res = await client.post('/api/inventory/movements', {
    kind: 'OPENING',
    clientId: randomUUID(),
    productId,
    filled,
    empty,
  });
  if (res.statusCode !== 201) throw new Error(`stock: ${res.body}`);
}

/** A supplier with one ₹50 returnable can (100 filled, 20 empty in stock) and one store. */
export async function setupBusiness(app: FastifyInstance): Promise<Business> {
  const { client, me } = await signupSupplier(app);
  const canId = await createProduct(client);
  await addStock(client, canId, 100, 20);
  const storeId = await createStore(client);
  return { client, supplierId: me.user.supplierId, canId, storeId };
}

export function sale(
  storeId: string,
  items: { productId: string; quantity: number; emptyCollected?: number; unitPrice?: string }[],
  payment: { amount: string; method?: string },
  extra: Record<string, unknown> = {},
) {
  return { clientId: randomUUID(), storeId, items, payment: { method: 'CASH', ...payment }, ...extra };
}

export async function storeDetail(client: Client, storeId: string) {
  const res = await client.get(`/api/stores/${storeId}`);
  if (res.statusCode !== 200) throw new Error(`store detail: ${res.body}`);
  return res.json<{ balance: string; cansOutstanding: number; cans: { productId: string; quantity: number }[] }>();
}

export async function stockOf(client: Client, productId: string) {
  const res = await client.get('/api/inventory');
  const row = res
    .json<{ productId: string; filled: number; empty: number; withCustomers: number; damaged: number }[]>()
    .find((r) => r.productId === productId);
  if (!row) throw new Error('product missing from stock summary');
  return row;
}

/** Gives a store its own app login and returns a client signed in as that store. */
export async function storeUserClient(app: FastifyInstance, supplier: Client, storeId: string, phone: string, pin = '135790'): Promise<Client> {
  const res = await supplier.request('PUT', `/api/stores/${storeId}/login`, { phone, pin });
  if (res.statusCode !== 200) throw new Error(`store login: ${res.body}`);
  const client = new Client(app);
  const login = await client.post('/api/auth/login', { phone, pin });
  if (login.statusCode !== 200) throw new Error(`store sign-in: ${login.body}`);
  return client;
}
