import { fromMinor, toMinor, type Minor, type StorePriceDto } from '@wd/shared';
import { audit } from '../../lib/audit';
import type { Db, Tx } from '../../lib/db';
import { validationError } from '../../lib/errors';
import { decToMinor, minorToDec } from '../../lib/money';

/**
 * Every store pays its own agreed price per product; there is no list price. A sale or order
 * uses the store's price at that moment and copies it onto the order, so changing a price never
 * rewrites history.
 */

/** This store's price per product, in minor units. */
export async function storePriceMap(db: Db | Tx, supplierId: string, storeId: string): Promise<Map<string, Minor>> {
  const rows = await db.storePrice.findMany({ where: { supplierId, storeId }, select: { productId: true, price: true } });
  return new Map(rows.map((r) => [r.productId, decToMinor(r.price)]));
}

export async function storePriceDtos(db: Db | Tx, supplierId: string, storeId: string): Promise<StorePriceDto[]> {
  const map = await storePriceMap(db, supplierId, storeId);
  return [...map].map(([productId, price]) => ({ productId, price: fromMinor(price) }));
}

/**
 * Sets (or changes) a store's prices. Every product must belong to the business. Changes to an
 * existing price are audited; first-time prices are not (they are part of creating the store).
 */
export async function setStorePrices(
  tx: Tx,
  auth: { supplierId: string; userId: string },
  storeId: string,
  prices: { productId: string; price: string }[],
): Promise<void> {
  if (prices.length === 0) return;
  const ids = prices.map((p) => p.productId);
  const owned = await tx.product.count({ where: { id: { in: ids }, supplierId: auth.supplierId } });
  if (owned !== new Set(ids).size) throw validationError('One of the products is no longer available. Please refresh.');

  const current = await storePriceMap(tx, auth.supplierId, storeId);
  for (const { productId, price } of prices) {
    const next = toMinor(price);
    const before = current.get(productId);
    if (before === next) continue;
    await tx.storePrice.upsert({
      where: { storeId_productId: { storeId, productId } },
      create: { supplierId: auth.supplierId, storeId, productId, price: minorToDec(next) },
      update: { price: minorToDec(next) },
    });
    if (before !== undefined) {
      await audit(tx, {
        supplierId: auth.supplierId,
        actorId: auth.userId,
        action: 'PRICE_CHANGED',
        entity: 'Store',
        entityId: storeId,
        before: { productId, price: fromMinor(before) },
        after: { productId, price: fromMinor(next) },
      });
    }
  }
}

/**
 * Suggested prices for a new store: the price most recently agreed with any store, per product.
 * Most stores pay about the same, so the supplier usually only confirms.
 */
export async function latestPrices(db: Db, supplierId: string): Promise<StorePriceDto[]> {
  const rows = await db.storePrice.findMany({
    where: { supplierId },
    orderBy: { updatedAt: 'desc' },
    distinct: ['productId'],
    select: { productId: true, price: true },
  });
  return rows.map((r) => ({ productId: r.productId, price: fromMinor(decToMinor(r.price)) }));
}

/**
 * Unit price for each line of a sale or order. Uses the store's price; a line may carry its own
 * price (a one-off special price). A product the store has no price for yet needs one, and that
 * price is saved as the store's price so the next sale uses it.
 */
export async function resolveLinePrices<L extends { product: { id: string; name: string }; quantity: number; unitPrice?: string }>(
  tx: Tx,
  auth: { supplierId: string; userId: string },
  storeId: string,
  lines: L[],
  opts: { canSetPrice: boolean },
): Promise<(Omit<L, 'unitPrice'> & { unitPrice: Minor })[]> {
  const prices = await storePriceMap(tx, auth.supplierId, storeId);
  const newPrices: { productId: string; price: string }[] = [];
  const resolved = lines.map((line) => {
    const saved = prices.get(line.product.id);
    if (line.unitPrice !== undefined && opts.canSetPrice) {
      if (saved === undefined && toMinor(line.unitPrice) > 0) newPrices.push({ productId: line.product.id, price: line.unitPrice });
      return { ...line, unitPrice: toMinor(line.unitPrice) };
    }
    if (saved !== undefined) return { ...line, unitPrice: saved };
    if (line.quantity === 0) return { ...line, unitPrice: 0 };
    throw opts.canSetPrice
      ? validationError(`Enter this client's price for ${line.product.name}.`, { price: 'Enter a price' })
      : validationError(`${line.product.name} can't be ordered yet: ask your supplier to set your price.`);
  });
  await setStorePrices(tx, auth, storeId, newPrices);
  return resolved;
}
