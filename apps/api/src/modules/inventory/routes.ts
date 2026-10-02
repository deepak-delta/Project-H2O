import {
  stockMovementSchema,
  zonedDayRangeForKey,
  type CanHolder,
  type MovementDto,
  type StockSummary,
} from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { requireSupplier } from '../../lib/auth-context';
import { audit } from '../../lib/audit';
import { getBusinessSettings } from '../../lib/business';
import type { Db } from '../../lib/db';
import { notFound, validationError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { decodeCursor, olderThan, toPage } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import type { MovementType, Prisma } from '../../generated/prisma/client';
import { levelsOf, lockProductStock, stockByProduct } from './stock';

const movementInclude = {
  product: { select: { name: true } },
  store: { select: { name: true } },
  order: { select: { orderNumber: true } },
} as const;

type MovementRow = Prisma.InventoryMovementGetPayload<{ include: typeof movementInclude }>;

export function toMovementDto(m: MovementRow): MovementDto {
  return {
    id: m.id,
    type: m.type,
    productName: m.product.name,
    filledDelta: m.filledDelta,
    emptyDelta: m.emptyDelta,
    withCustomersDelta: m.withCustomersDelta,
    damagedDelta: m.damagedDelta,
    storeName: m.store?.name ?? null,
    orderNumber: m.order?.orderNumber ?? null,
    reason: m.reason,
    occurredAt: m.occurredAt.toISOString(),
  };
}

export async function loadStockSummary(db: Db, supplierId: string): Promise<StockSummary[]> {
  const [products, stock] = await Promise.all([
    db.product.findMany({
      where: { supplierId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, isReturnable: true, active: true },
    }),
    stockByProduct(db, supplierId),
  ]);
  return products
    .filter((p) => {
      const s = levelsOf(stock, p.id);
      return p.active || s.filled || s.empty || s.withCustomers || s.damaged;
    })
    .map((p) => ({ productId: p.id, productName: p.name, isReturnable: p.isReturnable, ...levelsOf(stock, p.id) }));
}

interface Deltas {
  type: MovementType;
  filledDelta: number;
  emptyDelta: number;
  damagedDelta: number;
  reason: string | null;
}

export function registerInventoryRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/inventory', async (req) => {
    const auth = requireSupplier(req);
    return loadStockSummary(db, auth.supplierId);
  });

  app.get('/api/inventory/movements', async (req) => {
    const auth = requireSupplier(req);
    const q = parse(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        productId: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );
    const where: Prisma.InventoryMovementWhereInput = { supplierId: auth.supplierId };
    if (q.productId) where.productId = q.productId;
    if (q.date) {
      const { timezone } = await getBusinessSettings(db, auth.supplierId);
      const range = zonedDayRangeForKey(q.date, timezone);
      where.occurredAt = { gte: range.start, lt: range.end };
    }
    const rows = await db.inventoryMovement.findMany({
      where: { ...where, ...olderThan('occurredAt', decodeCursor(q.cursor)) },
      include: movementInclude,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, (r) => ({ at: r.occurredAt, id: r.id }), toMovementDto);
  });

  /** Which stores have this product's cans right now — "who has my cans?" */
  app.get('/api/inventory/holders', async (req) => {
    const auth = requireSupplier(req);
    const { productId } = parse(z.object({ productId: z.string().optional() }), req.query);
    const rows = await db.$queryRaw<
      { storeId: string; storeName: string; phone: string | null; quantity: bigint; lastDeliveryAt: Date | null }[]
    >`
      SELECT s.id AS "storeId", s.name AS "storeName", s.phone,
             SUM(m."withCustomersDelta") AS quantity,
             MAX(m."occurredAt") FILTER (WHERE m.type = 'DELIVERY') AS "lastDeliveryAt"
      FROM "InventoryMovement" m
      JOIN "Store" s ON s.id = m."storeId"
      WHERE m."supplierId" = ${auth.supplierId}
        AND m."storeId" IS NOT NULL
        AND (${productId ?? null}::text IS NULL OR m."productId" = ${productId ?? null})
      GROUP BY s.id
      HAVING SUM(m."withCustomersDelta") <> 0
      ORDER BY quantity DESC, s.name ASC
      LIMIT 200`;
    return rows.map(
      (r): CanHolder => ({
        storeId: r.storeId,
        storeName: r.storeName,
        phone: r.phone,
        quantity: Number(r.quantity),
        lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
      }),
    );
  });

  app.post('/api/inventory/movements', async (req, reply) => {
    const auth = requireSupplier(req);
    const input = parse(stockMovementSchema, req.body);

    const product = await db.product.findFirst({ where: { id: input.productId, supplierId: auth.supplierId } });
    if (!product) throw notFound('Product');

    const { result, replayed } = await idempotent(
      () =>
        db.inventoryMovement.findFirst({
          where: { supplierId: auth.supplierId, clientId: input.clientId },
          include: movementInclude,
        }),
      () =>
        db.$transaction(async (tx) => {
          await lockProductStock(tx, auth.supplierId, product.id);
          const current = levelsOf(await stockByProduct(tx, auth.supplierId, [product.id]), product.id);
          const deltas = computeDeltas(input, current);

          const movement = await tx.inventoryMovement.create({
            data: {
              supplierId: auth.supplierId,
              productId: product.id,
              createdById: auth.userId,
              clientId: input.clientId,
              ...deltas,
            },
            include: movementInclude,
          });
          if (input.kind === 'ADJUSTMENT' || input.kind === 'LOSS') {
            await audit(tx, {
              supplierId: auth.supplierId,
              actorId: auth.userId,
              action: input.kind === 'ADJUSTMENT' ? 'STOCK_CORRECTED' : 'STOCK_LOST',
              entity: 'InventoryMovement',
              entityId: movement.id,
              before: { filled: current.filled, empty: current.empty, damaged: current.damaged },
              after: {
                filled: current.filled + deltas.filledDelta,
                empty: current.empty + deltas.emptyDelta,
                damaged: current.damaged + deltas.damagedDelta,
              },
            });
          }
          return movement;
        }),
    );

    return reply.status(replayed ? 200 : 201).send(toMovementDto(result));
  });
}

type StockMovementOutput = z.output<typeof stockMovementSchema>;

function computeDeltas(
  input: StockMovementOutput,
  current: { filled: number; empty: number; damaged: number },
): Deltas {
  const need = (have: number, want: number, what: string) => {
    if (want > have) {
      throw validationError(
        `Only ${Math.max(have, 0)} ${what} in stock. If the real count is different, use "Correct count" first.`,
      );
    }
  };

  switch (input.kind) {
    case 'OPENING':
    case 'PURCHASE':
      if (input.filled === 0 && input.empty === 0) throw validationError('Enter how many cans.');
      return { type: input.kind, filledDelta: input.filled, emptyDelta: input.empty, damagedDelta: 0, reason: input.reason };
    case 'REFILL':
      need(current.empty, input.quantity, 'empty cans');
      return { type: 'REFILL', filledDelta: input.quantity, emptyDelta: -input.quantity, damagedDelta: 0, reason: input.reason };
    case 'DAMAGE':
    case 'LOSS': {
      const fromFilled = input.from === 'FILLED';
      need(fromFilled ? current.filled : current.empty, input.quantity, fromFilled ? 'filled cans' : 'empty cans');
      return {
        type: input.kind,
        filledDelta: fromFilled ? -input.quantity : 0,
        emptyDelta: fromFilled ? 0 : -input.quantity,
        damagedDelta: input.kind === 'DAMAGE' ? input.quantity : 0,
        reason: input.reason,
      };
    }
    case 'ADJUSTMENT': {
      const filledDelta = input.countedFilled - current.filled;
      const emptyDelta = input.countedEmpty - current.empty;
      if (filledDelta === 0 && emptyDelta === 0) throw validationError('The count already matches the stock.');
      return { type: 'ADJUSTMENT', filledDelta, emptyDelta, damagedDelta: 0, reason: input.reason };
    }
  }
}

