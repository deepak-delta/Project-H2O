export const ROLES = ['SUPPLIER', 'STORE', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ['SUPPLIER', 'STORE'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Methods that move real money. "Credit" is not a method — it is the unpaid remainder. */
export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const LEDGER_TYPES = [
  'SALE',
  'PAYMENT',
  'CREDIT_ADJUSTMENT',
  'REFUND',
  'DISCOUNT',
  'OPENING_BALANCE',
  'REVERSAL',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE',
  'REFILL',
  'DELIVERY',
  'RETURN',
  'DAMAGE',
  'LOSS',
  'ADJUSTMENT',
  'REVERSAL',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const CASHFLOW_TYPES = ['INCOME', 'EXPENSE'] as const;
export type CashFlowType = (typeof CASHFLOW_TYPES)[number];

export const INCOME_CATEGORIES = [
  'WATER_SALE',
  'DEPOSIT',
  'CREDIT_RECOVERY',
  'OTHER_INCOME',
] as const;
export const EXPENSE_CATEGORIES = [
  'FUEL',
  'WATER_PURCHASE',
  'VEHICLE',
  'SALARY',
  'MAINTENANCE',
  'ELECTRICITY',
  'MISC',
] as const;
export const CASHFLOW_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES] as const;
export type CashFlowCategory = (typeof CASHFLOW_CATEGORIES)[number];

export const STORE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const SYNC_STATES = ['PENDING', 'SYNCING', 'SYNCED', 'FAILED'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/** Below this many filled cans (all returnable products together) the supplier is warned. */
export const LOW_STOCK_FILLED_CANS = 10;
