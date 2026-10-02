import {
  cancelOrderSchema,
  deliverOrderSchema,
  ORDER_STATUSES,
  orderStatusChangeSchema,
  placeOrderSchema,
  quickSaleSchema,
  zonedDayRangeForKey,
} from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../app';
import * as notify from '../notifications/events';
import { ownedBy, requireAuth, requireSupplier } from '../../lib/auth-context';
import { getBusinessSettings } from '../../lib/business';
import { decodeCursor, olderThan, toPage } from '../../lib/pagination';
import { parse } from '../../lib/validate';
import type { Prisma } from '../../generated/prisma/client';
import { loadOrderDto, orderListInclude, toOrderListItem } from './order-dto';
import { cancelOrder, changeOrderStatus, deliverOrder, placeOrder } from './lifecycle';
import { quickSale } from './quick-sale';

const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'] as const;
const idParams = z.object({ id: z.string().min(1) });

export function registerOrderRoutes(app: FastifyInstance, { db, notifier }: Services): void {
  /** Create + deliver + collect payment in one step (supplier's main flow). */
  app.post('/api/orders/quick-sale', async (req, reply) => {
    const auth = requireSupplier(req);
    const input = parse(quickSaleSchema, req.body);
    const result = await quickSale(db, auth, input);
    if (!result.replayed) {
      await notify.orderDelivered(db, notifier, auth.supplierId, result.order, result.storeBalance, input.items);
    }
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  app.get('/api/orders', async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      z.object({
        status: z.union([z.enum(ORDER_STATUSES), z.literal('OPEN')]).optional(),
        storeId: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        search: z.string().trim().max(60).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );

    // Store users are always pinned to their own store, whatever they ask for.
    const where: Prisma.OrderWhereInput = { ...ownedBy(auth) };
    if (q.storeId && auth.role === 'SUPPLIER') where.storeId = q.storeId;
    if (q.status === 'OPEN') where.status = { in: [...OPEN_STATUSES] };
    else if (q.status) where.status = q.status;
    if (q.date) {
      const { timezone } = await getBusinessSettings(db, auth.supplierId);
      const range = zonedDayRangeForKey(q.date, timezone);
      where.orderDate = { gte: range.start, lt: range.end };
    }
    if (q.search) {
      const number = /^#?(\d{1,9})$/.exec(q.search)?.[1];
      where.OR = [
        ...(number ? [{ orderNumber: Number(number) }] : []),
        { store: { name: { contains: q.search, mode: 'insensitive' } } },
      ];
    }

    const rows = await db.order.findMany({
      where: { AND: [where, olderThan('orderDate', decodeCursor(q.cursor))] },
      include: orderListInclude,
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, (r) => ({ at: r.orderDate, id: r.id }), toOrderListItem);
  });

  app.get('/api/orders/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return loadOrderDto(db, ownedBy(auth), id);
  });

  /** Place an order for later delivery (store app, or a supplier noting a phone order). */
  app.post('/api/orders', async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(placeOrderSchema, req.body);
    const { order, replayed } = await placeOrder(db, auth, input);
    if (!replayed && auth.role === 'STORE') await notify.orderPlaced(db, notifier, auth.supplierId, order);
    return reply.status(replayed ? 200 : 201).send(order);
  });

  app.post('/api/orders/:id/status', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(idParams, req.params);
    const { status } = parse(orderStatusChangeSchema, req.body);
    const { order, changed } = await changeOrderStatus(db, auth, id, status);
    if (changed) await notify.orderStatusChanged(notifier, order);
    return order;
  });

  /** Deliver an open order, fully or partly. */
  app.post('/api/orders/:id/deliver', async (req, reply) => {
    const auth = requireSupplier(req);
    const { id } = parse(idParams, req.params);
    const input = parse(deliverOrderSchema, req.body);
    const result = await deliverOrder(db, auth, id, input);
    if (!result.replayed) {
      await notify.orderDelivered(db, notifier, auth.supplierId, result.order, result.storeBalance, input.items);
    }
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  app.post('/api/orders/:id/cancel', async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const input = parse(cancelOrderSchema, req.body ?? {});
    const order = await cancelOrder(db, auth, id, input);
    await notify.orderCancelled(notifier, auth.supplierId, order, auth.role === 'STORE');
    return order;
  });
}
