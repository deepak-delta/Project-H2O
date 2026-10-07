/** Central query keys so mutations can invalidate exactly what they affect. */
export const qk = {
  dashboard: ['dashboard'] as const,
  products: (all = false) => ['products', { all }] as const,
  productsRoot: ['products'] as const,
  stores: (params: Record<string, unknown>) => ['stores', 'list', params] as const,
  storesRoot: ['stores'] as const,
  store: (id: string) => ['stores', 'detail', id] as const,
  storeLedger: (id: string) => ['stores', 'ledger', id] as const,
  storeCans: (id: string) => ['stores', 'cans', id] as const,
  orders: (params: Record<string, unknown>) => ['orders', 'list', params] as const,
  ordersRoot: ['orders'] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  payments: (params: Record<string, unknown>) => ['payments', 'list', params] as const,
  paymentsRoot: ['payments'] as const,
  inventory: ['inventory'] as const,
  movements: (params: Record<string, unknown>) => ['inventory', 'movements', params] as const,
  holders: (productId?: string) => ['inventory', 'holders', productId ?? 'all'] as const,
  storeHome: ['store-home'] as const,
  cashflow: ['cashflow'] as const,
  reports: ['reports'] as const,
  /** Delivery staff: the list (owner), and each person's day. */
  staffRoot: ['staff'] as const,
  /** `id` is a staff member's id, or 'me' for the signed-in member of staff. */
  staffToday: (id: string) => ['staff', 'today', id] as const,
};

/** Everything a sale, payment or stock change can affect. */
export const MONEY_AND_STOCK_KEYS = [qk.dashboard, qk.storesRoot, qk.ordersRoot, qk.paymentsRoot, qk.inventory, qk.cashflow, qk.reports, qk.storeHome, qk.staffRoot];
