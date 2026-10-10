import { Prisma } from '../../generated/prisma/client';

// Shared report definitions, so every report adds things up the same way.

/** Net sales from LedgerEntry: sales and discounts, less sales undone by cancelled orders. */
export const NET_SALES = Prisma.sql`COALESCE(SUM(amount) FILTER (WHERE type IN ('SALE', 'DISCOUNT') OR (type = 'REVERSAL' AND "paymentId" IS NULL)), 0)`;

/** Money collected from LedgerEntry: payments, less payments reversed (those carry a paymentId). */
export const COLLECTED = Prisma.sql`COALESCE(-SUM(amount) FILTER (WHERE type = 'PAYMENT' OR (type = 'REVERSAL' AND "paymentId" IS NOT NULL)), 0)`;

/** Full cans delivered from InventoryMovement, less deliveries undone by cancelled orders. */
export const CANS_DELIVERED = Prisma.sql`COALESCE(SUM(-"filledDelta") FILTER (WHERE type = 'DELIVERY' OR (type = 'REVERSAL' AND "deliveryId" IS NOT NULL)), 0)`;
