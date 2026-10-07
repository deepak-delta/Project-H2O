import { fromMinor, type StoreHomeDto } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app';
import { requireStore } from '../../lib/auth-context';
import { storeCanBalances } from '../inventory/stock';
import { storeBalanceMinor } from '../ledger/balance';
import { storePriceDtos } from '../prices/prices';
import { orderListInclude, toOrderListItem } from '../orders/order-dto';
import { paymentInclude, toPaymentDto } from '../payments/routes';

const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'] as const;

/** The store owner's home screen in one request. Everything is pinned to their own store. */
export function registerStoreAppRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/store/home', async (req): Promise<StoreHomeDto> => {
    const { supplierId, storeId } = requireStore(req);
    const scope = { supplierId, storeId };

    const [store, supplier, balance, canMap, products, lastDelivery, openOrders, recentOrders, recentPayments, prices] = await Promise.all([
      db.store.findFirstOrThrow({ where: { id: storeId, supplierId }, select: { id: true, name: true } }),
      db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { businessName: true, phone: true } }),
      storeBalanceMinor(db, supplierId, storeId),
      storeCanBalances(db, supplierId, storeId),
      db.product.findMany({ where: { supplierId, isReturnable: true }, select: { id: true, name: true, active: true } }),
      db.delivery.findFirst({
        where: scope,
        orderBy: { deliveredAt: 'desc' },
        include: { items: { select: { productId: true, deliveredQty: true } }, order: { select: { orderNumber: true } } },
      }),
      db.order.findMany({ where: { ...scope, status: { in: [...OPEN] } }, include: orderListInclude, orderBy: { orderDate: 'desc' }, take: 5 }),
      db.order.findMany({ where: scope, include: orderListInclude, orderBy: [{ orderDate: 'desc' }, { id: 'desc' }], take: 5 }),
      db.payment.findMany({ where: scope, include: paymentInclude, orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }], take: 5 }),
      storePriceDtos(db, supplierId, storeId),
    ]);

    const cans = products
      .filter((p) => (canMap.get(p.id) ?? 0) !== 0 || p.active)
      .map((p) => ({ productId: p.id, productName: p.name, quantity: canMap.get(p.id) ?? 0 }));

    return {
      store,
      supplier,
      balance: fromMinor(balance),
      cans,
      cansOutstanding: cans.reduce((s, c) => s + c.quantity, 0),
      lastDelivery: lastDelivery
        ? {
            orderId: lastDelivery.orderId,
            orderNumber: lastDelivery.order.orderNumber,
            deliveredAt: lastDelivery.deliveredAt.toISOString(),
            quantity: lastDelivery.items.reduce((s, i) => s + i.deliveredQty, 0),
          }
        : null,
      openOrders: openOrders.map(toOrderListItem),
      recentOrders: recentOrders.map(toOrderListItem),
      recentPayments: recentPayments.map(toPaymentDto),
      lastOrderItems:
        lastDelivery?.items.filter((i) => i.deliveredQty > 0).map((i) => ({ productId: i.productId, quantity: i.deliveredQty })) ?? [],
      prices,
    };
  });
}
