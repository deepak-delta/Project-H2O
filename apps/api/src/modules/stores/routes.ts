import {
  canCountSchema,
  canReturnSchema,
  createStoreSchema,
  fromMinor,
  storeInputSchema,
  storeLoginSchema,
  storePricesSchema,
  storeStatusSchema,
  toMinor,
  type CanMovementDto,
  type LedgerEntryDto,
  type StoreDetail,
  type StoreListItem,
} from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../app';
import * as notify from '../notifications/events';
import {
  requireOperator,
  requireOwnerOrStore,
  requireSupplier,
  type StoreContext,
  type SupplierContext,
} from '../../lib/auth-context';
import { audit } from '../../lib/audit';
import type { Db } from '../../lib/db';
import { conflict, notFound, validationError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { decToMinor, decToString, minorToDec, sqlSumToMinor } from '../../lib/money';
import { resolveOccurredAt } from '../../lib/occurred-at';
import { decodeCursor, olderThan, toPage } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import { Prisma } from '../../generated/prisma/client';
import { lockProductStock, storeCanBalances } from '../inventory/stock';
import { latestPrices, setStorePrices, storePriceDtos } from '../prices/prices';
import { storeBalanceMinor } from '../ledger/balance';
import { hashPin } from '../auth/pin';

const listQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  filter: z.enum(['all', 'owes', 'cans', 'inactive']).default('all'),
  sort: z.enum(['name', 'recent', 'balance']).default('name'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

interface StoreRow {
  id: string;
  name: string;
  category: 'STORE' | 'HOME' | 'INDIVIDUAL' | 'OTHER';
  categoryOther: string | null;
  ownerName: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  balance: unknown;
  cans: bigint | number | null;
  lastDeliveryAt: Date | null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function listStores(db: Db, supplierId: string, q: z.output<typeof listQuerySchema>) {
  const status = q.filter === 'inactive' ? 'INACTIVE' : 'ACTIVE';
  const pattern = q.search ? `%${escapeLike(q.search)}%` : null;
  const digits = q.search?.replace(/\D/g, '') ?? '';
  const phonePattern = digits.length >= 3 ? `%${digits}%` : null;

  const orderBy =
    q.filter === 'owes' || q.sort === 'balance'
      ? Prisma.sql`balance DESC, s.name ASC`
      : q.filter === 'cans'
        ? Prisma.sql`cans DESC, s.name ASC`
        : q.sort === 'recent'
          ? Prisma.sql`"lastDeliveryAt" DESC NULLS LAST, s.name ASC`
          : Prisma.sql`s.name ASC`;

  // Balances and cans come from ClientTotals (trigger-maintained): no re-adding of history.
  const rows = await db.$queryRaw<StoreRow[]>`
    SELECT s.id, s.name, s.category::text AS category, s."categoryOther", s."ownerName", s.phone, s.status,
           COALESCE(t.balance, 0) AS balance,
           COALESCE(t.cans, 0) AS cans,
           t."lastDeliveryAt"
    FROM "Store" s
    LEFT JOIN "ClientTotals" t ON t."storeId" = s.id
    WHERE s."supplierId" = ${supplierId}
      AND s.status = ${status}::"StoreStatus"
      AND (${pattern}::text IS NULL
           OR s.name ILIKE ${pattern}
           OR s."ownerName" ILIKE ${pattern}
           OR s."categoryOther" ILIKE ${pattern}
           OR (s.category <> 'OTHER' AND s.category::text ILIKE ${pattern})
           OR (${phonePattern}::text IS NOT NULL AND s.phone LIKE ${phonePattern}))
      AND (${q.filter} <> 'owes' OR COALESCE(t.balance, 0) > 0)
      AND (${q.filter} <> 'cans' OR COALESCE(t.cans, 0) > 0)
    ORDER BY ${orderBy}
    LIMIT ${q.limit + 1} OFFSET ${q.offset}`;

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  // Prices travel with the list so a delivery can be priced offline from the cached list.
  const priceRows = await db.storePrice.findMany({
    where: { supplierId, storeId: { in: page.map((r) => r.id) } },
    select: { storeId: true, productId: true, price: true },
  });
  const pricesByStore = new Map<string, { productId: string; price: string }[]>();
  for (const p of priceRows) {
    const list = pricesByStore.get(p.storeId) ?? [];
    list.push({ productId: p.productId, price: decToString(p.price) });
    pricesByStore.set(p.storeId, list);
  }

  return {
    items: page.map((r): StoreListItem => ({
      id: r.id,
      name: r.name,
      category: r.category,
      categoryOther: r.categoryOther,
      ownerName: r.ownerName,
      phone: r.phone,
      status: r.status,
      balance: fromMinor(sqlSumToMinor(r.balance)),
      cansOutstanding: Number(r.cans ?? 0),
      lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
      prices: pricesByStore.get(r.id) ?? [],
    })),
    nextOffset: hasMore ? q.offset + q.limit : null,
  };
}

async function loadStoreDetail(db: Db, supplierId: string, storeId: string): Promise<StoreDetail> {
  const store = await db.store.findFirst({
    where: { id: storeId, supplierId },
    include: { loginUser: { select: { id: true, active: true, phone: true } } },
  });
  if (!store) throw notFound('Client');

  const [balance, canMap, products, lastDelivery, prices] = await Promise.all([
    storeBalanceMinor(db, supplierId, storeId),
    storeCanBalances(db, supplierId, storeId),
    db.product.findMany({
      where: { supplierId },
      select: { id: true, name: true, isReturnable: true, active: true },
    }),
    db.delivery.findFirst({
      where: { supplierId, storeId },
      orderBy: { deliveredAt: 'desc' },
      include: { items: { select: { productId: true, deliveredQty: true } } },
    }),
    storePriceDtos(db, supplierId, storeId),
  ]);

  const cans = products
    .filter((p) => p.isReturnable && ((canMap.get(p.id) ?? 0) !== 0 || p.active))
    .map((p) => ({ productId: p.id, productName: p.name, quantity: canMap.get(p.id) ?? 0 }));

  return {
    id: store.id,
    name: store.name,
    category: store.category,
    categoryOther: store.categoryOther,
    ownerName: store.ownerName,
    phone: store.phone,
    status: store.status,
    address: store.address,
    notes: store.notes,
    creditLimit: store.creditLimit ? decToString(store.creditLimit) : null,
    balance: fromMinor(balance),
    cansOutstanding: cans.reduce((sum, c) => sum + c.quantity, 0),
    cans,
    prices,
    lastDeliveryAt: lastDelivery?.deliveredAt.toISOString() ?? null,
    lastOrderItems:
      lastDelivery?.items
        .filter((i) => i.deliveredQty > 0)
        .map((i) => ({ productId: i.productId, quantity: i.deliveredQty })) ?? [],
    hasLogin: Boolean(store.loginUser?.active),
    loginPhone: store.loginUser?.active ? store.loginUser.phone : null,
    createdAt: store.createdAt.toISOString(),
  };
}

/** What staff may see of a store: no app-login details (those are the owner's business). */
function forStaff(detail: StoreDetail): StoreDetail {
  return { ...detail, hasLogin: false, loginPhone: null };
}

/** Suppliers may open any of their stores; a store user only their own. Others get a 404. */
async function assertStoreAccess(
  db: Db,
  auth: SupplierContext | StoreContext,
  storeId: string,
): Promise<void> {
  if (auth.role === 'STORE') {
    if (auth.storeId !== storeId) throw notFound('Client');
    return;
  }
  const store = await db.store.findFirst({
    where: { id: storeId, supplierId: auth.supplierId },
    select: { id: true },
  });
  if (!store) throw notFound('Client');
}

export function registerStoreRoutes(app: FastifyInstance, { db, env, notifier }: Services): void {
  app.get('/api/stores', async (req) => {
    const auth = requireOperator(req);
    const q = parse(listQuerySchema, req.query);
    // Staff work with active stores only.
    return listStores(
      db,
      auth.supplierId,
      auth.role === 'STAFF' && q.filter === 'inactive' ? { ...q, filter: 'all' } : q,
    );
  });

  app.post('/api/stores', async (req, reply) => {
    const auth = requireSupplier(req);
    const input = parse(createStoreSchema, req.body);
    const openingCans = input.openingCans.filter((c) => c.quantity > 0);

    if (openingCans.length > 0) {
      const ids = openingCans.map((c) => c.productId);
      const valid = await db.product.count({
        where: { id: { in: ids }, supplierId: auth.supplierId, isReturnable: true },
      });
      if (valid !== new Set(ids).size)
        throw validationError('Opening cans must be for your returnable products.');
    }

    // A store is created with its price for every product on sale.
    const onSale = await db.product.findMany({
      where: { supplierId: auth.supplierId, active: true },
      select: { id: true, name: true },
    });
    const priced = new Set(input.prices.map((p) => p.productId));
    const missing = onSale.find((p) => !priced.has(p.id));
    if (missing)
      throw validationError(`Enter this client's price for ${missing.name}.`, {
        prices: 'Enter a price for every product',
      });

    const storeId = await db.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          supplierId: auth.supplierId,
          createdById: auth.userId,
          name: input.name,
          ownerName: input.ownerName,
          category: input.category,
          categoryOther: input.category === 'OTHER' ? input.categoryOther : null,
          phone: input.phone,
          address: input.address,
          notes: input.notes,
          creditLimit: input.creditLimit,
        },
      });
      const opening = input.openingBalance ? toMinor(input.openingBalance) : 0;
      if (opening !== 0) {
        await tx.ledgerEntry.create({
          data: {
            supplierId: auth.supplierId,
            storeId: store.id,
            type: 'OPENING_BALANCE',
            amount: minorToDec(opening),
            note: 'Balance brought forward',
            createdById: auth.userId,
          },
        });
      }
      if (openingCans.length > 0) {
        await tx.inventoryMovement.createMany({
          data: openingCans.map((c) => ({
            supplierId: auth.supplierId,
            productId: c.productId,
            storeId: store.id,
            type: 'OPENING' as const,
            withCustomersDelta: c.quantity,
            reason: 'Cans already at the store',
            createdById: auth.userId,
          })),
        });
      }
      await setStorePrices(tx, auth, store.id, input.prices);
      return store.id;
    });

    return reply.status(201).send(await loadStoreDetail(db, auth.supplierId, storeId));
  });

  /** Prices to suggest for a new store: the ones most recently agreed with any store. */
  app.get('/api/stores/price-suggestions', async (req) => {
    const auth = requireSupplier(req);
    return latestPrices(db, auth.supplierId);
  });

  /** Change what a store pays. Past orders keep the prices they were made at. */
  app.put('/api/stores/:id/prices', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(storePricesSchema, req.body);
    const store = await db.store.findFirst({
      where: { id, supplierId: auth.supplierId },
      select: { id: true },
    });
    if (!store) throw notFound('Client');
    await db.$transaction((tx) => setStorePrices(tx, auth, id, input.prices));
    return loadStoreDetail(db, auth.supplierId, id);
  });

  app.get('/api/stores/:id', async (req) => {
    const auth = requireOperator(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const detail = await loadStoreDetail(db, auth.supplierId, id);
    if (auth.role === 'STAFF') {
      if (detail.status !== 'ACTIVE') throw notFound('Client');
      return forStaff(detail);
    }
    return detail;
  });

  app.patch('/api/stores/:id', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(storeInputSchema, req.body);
    const result = await db.store.updateMany({
      where: { id, supplierId: auth.supplierId },
      data: {
        name: input.name,
        ownerName: input.ownerName,
        category: input.category,
        categoryOther: input.category === 'OTHER' ? input.categoryOther : null,
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        creditLimit: input.creditLimit,
      },
    });
    if (result.count === 0) throw notFound('Client');
    return loadStoreDetail(db, auth.supplierId, id);
  });

  /** Deactivate instead of delete: the store's history stays intact. */
  app.post('/api/stores/:id/status', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { status } = parse(storeStatusSchema, req.body);
    const store = await db.store.findFirst({ where: { id, supplierId: auth.supplierId } });
    if (!store) throw notFound('Client');

    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id }, data: { status } });
      // An inactive store's login stops working immediately. Reactivating does not silently
      // turn it back on: the supplier re-enables app access deliberately.
      const user = await tx.user.findFirst({ where: { storeId: id } });
      if (user && status === 'INACTIVE') {
        await tx.user.update({ where: { id: user.id }, data: { active: false } });
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Their phones stop receiving this business's notifications too.
        await tx.pushSubscription.deleteMany({ where: { userId: user.id } });
      }
      await audit(tx, {
        supplierId: auth.supplierId,
        actorId: auth.userId,
        action: status === 'ACTIVE' ? 'STORE_REACTIVATED' : 'STORE_DEACTIVATED',
        entity: 'Store',
        entityId: id,
        before: { status: store.status },
        after: { status },
      });
    });
    return loadStoreDetail(db, auth.supplierId, id);
  });

  /** Money ledger with a running balance — the digital version of the shop's notebook page. */
  app.get('/api/stores/:id/ledger', async (req) => {
    const auth = requireOwnerOrStore(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const q = parse(
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );
    await assertStoreAccess(db, auth, id);

    const cursor = decodeCursor(q.cursor);
    const rows = await db.ledgerEntry.findMany({
      where: { supplierId: auth.supplierId, storeId: id, ...olderThan('occurredAt', cursor) },
      include: { order: { select: { orderNumber: true } }, payment: { select: { method: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });

    // Balance right after the newest row on this page = sum of everything up to and including it.
    const first = rows[0];
    let running = 0;
    if (first) {
      const upTo = await db.ledgerEntry.aggregate({
        where: {
          supplierId: auth.supplierId,
          storeId: id,
          OR: [
            { occurredAt: { lt: first.occurredAt } },
            { occurredAt: first.occurredAt, id: { lte: first.id } },
          ],
        },
        _sum: { amount: true },
      });
      running = decToMinor(upTo._sum.amount);
    }

    const withBalance = rows.map((r) => {
      const balanceAfter = running;
      running -= decToMinor(r.amount);
      return { row: r, balanceAfter };
    });

    return toPage(
      withBalance,
      q.limit,
      ({ row }) => ({ at: row.occurredAt, id: row.id }),
      ({ row, balanceAfter }): LedgerEntryDto => ({
        id: row.id,
        type: row.type,
        amount: decToString(row.amount),
        balanceAfter: fromMinor(balanceAfter),
        occurredAt: row.occurredAt.toISOString(),
        note: row.note,
        orderId: row.orderId,
        orderNumber: row.order?.orderNumber ?? null,
        paymentMethod: row.payment?.method ?? null,
      }),
    );
  });

  /** Can ledger: every change in the number of cans this store holds. */
  app.get('/api/stores/:id/cans', async (req) => {
    const auth = requireOwnerOrStore(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await assertStoreAccess(db, auth, id);
    const q = parse(
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );
    const rows = await db.inventoryMovement.findMany({
      where: {
        supplierId: auth.supplierId,
        storeId: id,
        withCustomersDelta: { not: 0 },
        ...olderThan('occurredAt', decodeCursor(q.cursor)),
      },
      include: { product: { select: { name: true } }, order: { select: { orderNumber: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(
      rows,
      q.limit,
      (r) => ({ at: r.occurredAt, id: r.id }),
      (r): CanMovementDto => ({
        id: r.id,
        type: r.type,
        productName: r.product.name,
        change: r.withCustomersDelta,
        occurredAt: r.occurredAt.toISOString(),
        orderNumber: r.order?.orderNumber ?? null,
        reason: r.reason,
      }),
    );
  });

  /** Empty cans picked up without a delivery. */
  /**
   * Owner: set the real number of cans at a client (cans already in the store + delivered −
   * empties back). Adds an ADJUSTMENT for the difference only; the owner's own filled/empty stock
   * is untouched because those cans were already out with the client.
   */
  app.put('/api/stores/:id/cans', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(canCountSchema, req.body);
    const store = await db.store.findFirst({ where: { id, supplierId: auth.supplierId }, select: { id: true, name: true } });
    if (!store) throw notFound('Client');
    const ids = input.items.map((i) => i.productId);
    const returnable = await db.product.findMany({ where: { id: { in: ids }, supplierId: auth.supplierId, isReturnable: true }, select: { id: true } });
    if (returnable.length !== new Set(ids).size) throw validationError('Only returnable cans are counted at a client.');

    await idempotent(
      () => db.inventoryMovement.findFirst({ where: { supplierId: auth.supplierId, clientId: input.clientId }, select: { id: true } }),
      () =>
        db.$transaction(async (tx) => {
          for (const item of input.items) await lockProductStock(tx, auth.supplierId, item.productId);
          const current = await storeCanBalances(tx, auth.supplierId, id);
          let first = true;
          for (const item of input.items) {
            const before = current.get(item.productId) ?? 0;
            const delta = item.quantity - before;
            if (delta === 0) continue;
            await tx.inventoryMovement.create({
              data: {
                supplierId: auth.supplierId,
                productId: item.productId,
                storeId: id,
                type: 'ADJUSTMENT',
                withCustomersDelta: delta,
                reason: input.notes ?? `Cans at client corrected from ${before} to ${item.quantity}`,
                // One retry key per request: only the first row carries it.
                clientId: first ? input.clientId : null,
                createdById: auth.userId,
              },
            });
            first = false;
            await audit(tx, {
              supplierId: auth.supplierId,
              actorId: auth.userId,
              action: 'CLIENT_CANS_CORRECTED',
              entity: 'Store',
              entityId: id,
              before: { productId: item.productId, cans: before },
              after: { productId: item.productId, cans: item.quantity },
            });
          }
          return { id };
        }),
    );
    return loadStoreDetail(db, auth.supplierId, id);
  });

  app.post('/api/stores/:id/can-returns', async (req, reply) => {
    const auth = requireOperator(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(canReturnSchema, req.body);
    const store = await db.store.findFirst({ where: { id, supplierId: auth.supplierId } });
    if (!store) throw notFound('Client');

    const items = input.items.filter((i) => i.quantity > 0);
    const products = await db.product.findMany({
      where: {
        id: { in: items.map((i) => i.productId) },
        supplierId: auth.supplierId,
        isReturnable: true,
      },
      select: { id: true },
    });
    if (products.length !== new Set(items.map((i) => i.productId)).size) {
      throw validationError('Only returnable cans can be collected.');
    }

    const { replayed } = await idempotent(
      () =>
        db.inventoryMovement.findFirst({
          where: { supplierId: auth.supplierId, clientId: input.clientId },
        }),
      () =>
        db.$transaction(async (tx) => {
          const now = resolveOccurredAt(input.occurredAt);
          const [first, ...rest] = items;
          if (!first) throw validationError('Enter how many cans were returned');
          const base = {
            supplierId: auth.supplierId,
            storeId: id,
            type: 'RETURN' as const,
            createdById: auth.userId,
            occurredAt: now,
            reason: input.notes,
          };
          // The client ID sits on the first row; it is enough to make the whole request idempotent.
          const created = await tx.inventoryMovement.create({
            data: {
              ...base,
              productId: first.productId,
              emptyDelta: first.quantity,
              withCustomersDelta: -first.quantity,
              clientId: input.clientId,
            },
          });
          if (rest.length > 0) {
            await tx.inventoryMovement.createMany({
              data: rest.map((i) => ({
                ...base,
                productId: i.productId,
                emptyDelta: i.quantity,
                withCustomersDelta: -i.quantity,
              })),
            });
          }
          return created;
        }),
    );

    const detail = await loadStoreDetail(db, auth.supplierId, id);
    return reply
      .status(replayed ? 200 : 201)
      .send(auth.role === 'STAFF' ? forStaff(detail) : detail);
  });

  /** Turn on (or reset) the store's own app login: phone + PIN chosen by the supplier. */
  app.put('/api/stores/:id/login', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(storeLoginSchema, req.body);
    const store = await db.store.findFirst({
      where: { id, supplierId: auth.supplierId },
      include: { loginUser: true },
    });
    if (!store) throw notFound('Client');
    if (store.status !== 'ACTIVE')
      throw validationError('Reactivate this client before giving it app access.');

    const taken = await db.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (taken && taken.id !== store.loginUser?.id) {
      throw conflict('This phone number already has a login. Use a different number.');
    }

    const pinHash = await hashPin(input.pin, env.PIN_PEPPER);
    await db.$transaction(async (tx) => {
      if (store.loginUser) {
        await tx.user.update({
          where: { id: store.loginUser.id },
          data: {
            phone: input.phone,
            pinHash,
            active: true,
            failedPinAttempts: 0,
            lockedUntil: null,
          },
        });
        // A new PIN signs the store out everywhere.
        await tx.session.updateMany({
          where: { userId: store.loginUser.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Their phones stop receiving this business's notifications too.
        await tx.pushSubscription.deleteMany({ where: { userId: store.loginUser.id } });
      } else {
        await tx.user.create({
          data: {
            supplierId: auth.supplierId,
            storeId: store.id,
            role: 'STORE',
            name: store.ownerName ?? store.name,
            phone: input.phone,
            pinHash,
          },
        });
      }
      await audit(tx, {
        supplierId: auth.supplierId,
        actorId: auth.userId,
        action: store.loginUser ? 'STORE_LOGIN_RESET' : 'STORE_LOGIN_CREATED',
        entity: 'Store',
        entityId: store.id,
        after: { phone: input.phone },
      });
    });
    return loadStoreDetail(db, auth.supplierId, id);
  });

  app.delete('/api/stores/:id/login', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const store = await db.store.findFirst({
      where: { id, supplierId: auth.supplierId },
      include: { loginUser: true },
    });
    if (!store) throw notFound('Client');
    if (store.loginUser?.active) {
      const userId = store.loginUser.id;
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { active: false } });
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Their phones stop receiving this business's notifications too.
        await tx.pushSubscription.deleteMany({ where: { userId: userId } });
        await audit(tx, {
          supplierId: auth.supplierId,
          actorId: auth.userId,
          action: 'STORE_LOGIN_DISABLED',
          entity: 'Store',
          entityId: id,
        });
      });
    }
    return loadStoreDetail(db, auth.supplierId, id);
  });

  /** Push a payment reminder to the store's phone (if it has the app with notifications on). */
  app.post('/api/stores/:id/remind', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const store = await db.store.findFirst({
      where: { id, supplierId: auth.supplierId },
      select: { id: true },
    });
    if (!store) throw notFound('Client');
    const balance = await storeBalanceMinor(db, auth.supplierId, id);
    if (balance <= 0) throw validationError("This client doesn't owe anything right now.");
    const sent = await notify.paymentReminder(
      db,
      notifier,
      auth.supplierId,
      id,
      fromMinor(balance),
    );
    return { sent };
  });
}
