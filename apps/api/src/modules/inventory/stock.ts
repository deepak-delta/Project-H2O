import type { Db, Tx } from '../../lib/db';

export interface StockLevels {
  filled: number;
  empty: number;
  withCustomers: number;
  damaged: number;
}

const ZERO: StockLevels = { filled: 0, empty: 0, withCustomers: 0, damaged: 0 };

/**
 * Current stock per product. Read from ProductStock, which a database trigger keeps equal to the
 * sum of every movement (updated in the same transaction as each movement), so this is one row
 * per product however long the history grows.
 */
export async function stockByProduct(
  db: Db | Tx,
  supplierId: string,
  productIds?: string[],
): Promise<Map<string, StockLevels>> {
  const rows = await db.productStock.findMany({
    where: { supplierId, ...(productIds ? { productId: { in: productIds } } : {}) },
  });
  return new Map(rows.map((r) => [r.productId, { filled: r.filled, empty: r.empty, withCustomers: r.withCustomers, damaged: r.damaged }]));
}

export function levelsOf(map: Map<string, StockLevels>, productId: string): StockLevels {
  return map.get(productId) ?? ZERO;
}

/** Cans of each product currently held by one client (trigger-maintained, like ProductStock). */
export async function storeCanBalances(db: Db | Tx, supplierId: string, storeId: string): Promise<Map<string, number>> {
  const rows = await db.clientCans.findMany({ where: { supplierId, storeId }, select: { productId: true, cans: true } });
  return new Map(rows.map((r) => [r.productId, r.cans]));
}

/**
 * Serialises stock-count corrections for one product so two people correcting the count at
 * the same moment can't both compute a delta from the same starting number.
 */
export async function lockProductStock(tx: Tx, supplierId: string, productId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${supplierId}:${productId}`}))`;
}
