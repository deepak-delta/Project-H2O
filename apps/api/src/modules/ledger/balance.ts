import type { Minor } from '@wd/shared';
import type { Db, Tx } from '../../lib/db';
import { decToMinor } from '../../lib/money';

/** What the store owes right now (negative = advance). Always derived from the ledger. */
export async function storeBalanceMinor(db: Db | Tx, supplierId: string, storeId: string): Promise<Minor> {
  const result = await db.ledgerEntry.aggregate({
    where: { supplierId, storeId },
    _sum: { amount: true },
  });
  return decToMinor(result._sum.amount);
}
