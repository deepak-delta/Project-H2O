import type { Db, Tx } from '../../lib/db';

export interface StockLevels {
  filled: number;
  empty: number;
  withCustomers: number;
  damaged: number;
}

const ZERO: StockLevels = { filled: 0, empty: 0, withCustomers: 0, damaged: 0 };

/** Current stock per product = sum of every movement ever recorded. */
export async function stockByProduct(
  db: Db | Tx,
  supplierId: string,
  productIds?: string[],
): Promise<Map<string, StockLevels>> {
  const rows = await db.inventoryMovement.groupBy({
    by: ['productId'],
    where: { supplierId, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { filledDelta: true, emptyDelta: true, withCustomersDelta: true, damagedDelta: true },
  });
  const map = new Map<string, StockLevels>();
  for (const r of rows) {
    map.set(r.productId, {
      filled: r._sum.filledDelta ?? 0,
      empty: r._sum.emptyDelta ?? 0,
      withCustomers: r._sum.withCustomersDelta ?? 0,
      damaged: r._sum.damagedDelta ?? 0,
    });
  }
  return map;
}

export function levelsOf(map: Map<string, StockLevels>, productId: string): StockLevels {
  return map.get(productId) ?? ZERO;
}

/** Cans of each product currently held by one store. */
export async function storeCanBalances(db: Db | Tx, supplierId: string, storeId: string): Promise<Map<string, number>> {
  const rows = await db.inventoryMovement.groupBy({
    by: ['productId'],
    where: { supplierId, storeId },
    _sum: { withCustomersDelta: true },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.withCustomersDelta ?? 0]));
}

/**
 * Serialises stock-count corrections for one product so two people correcting the count at
 * the same moment can't both compute a delta from the same starting number.
 */
export async function lockProductStock(tx: Tx, supplierId: string, productId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${supplierId}:${productId}`}))`;
}
