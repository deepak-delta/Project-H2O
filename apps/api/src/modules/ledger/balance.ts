import type { Minor } from '@wd/shared';
import type { Db, Tx } from '../../lib/db';
import { decToMinor } from '../../lib/money';

/**
 * What the client owes right now (negative = advance): the sum of its ledger, read from
 * ClientTotals, which a database trigger keeps equal to that sum in the same transaction.
 */
export async function storeBalanceMinor(db: Db | Tx, supplierId: string, storeId: string): Promise<Minor> {
  const row = await db.clientTotals.findFirst({ where: { supplierId, storeId }, select: { balance: true } });
  return decToMinor(row?.balance ?? null);
}
