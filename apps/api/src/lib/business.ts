import type { Db, Tx } from './db';

export interface BusinessSettings {
  currency: string;
  timezone: string;
}

export async function getBusinessSettings(db: Db | Tx, supplierId: string): Promise<BusinessSettings> {
  return db.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    select: { currency: true, timezone: true },
  });
}
