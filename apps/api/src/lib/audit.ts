import type { Prisma } from '../generated/prisma/client';
import type { Tx } from './db';

export interface AuditEntry {
  supplierId: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** Written inside the same transaction as the change it describes. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({ data: entry });
}
