import {
  assignOrderSchema,
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
import { ownedBy, requireAuth, requireOperator, requireOwnerOrStore, requireSupplier } from '../../lib/auth-context';
import { notFound, validationError } from '../../lib/errors';
import { businessToday, staffOrderWhere } from '../staff/scope';
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
    const auth = requireOperator(req);
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

    // Store users are always pinned to their own store, staff to their own work today,
    // whatever they ask for.
    const where: Prisma.OrderWhereInput =
      auth.role === 'STAFF' ? staffOrderWhere(auth, await businessToday(db, auth.supplierId)) : { ...ownedBy(auth) };
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
    if (auth.role === 'STAFF') {
      const visible = await db.order.count({ where: { AND: [{ id }, staffOrderWhere(auth, await businessToday(db, auth.supplierId))] } });
      if (!visible) throw notFound('Order');
      return loadOrderDto(db, { supplierId: auth.supplierId }, id);
    }
    return loadOrderDto(db, ownedBy(auth), id);
  });

  /** Place an order for later delivery (store app, or a supplier noting a phone order). */
  app.post('/api/orders', async (req, reply) => {
    const auth = requireOwnerOrStore(req);
    const input = parse(placeOrderSchema, req.body);
    const { order, replayed } = await placeOrder(db, auth, input);
    if (!replayed && auth.role === 'STORE') await notify.orderPlaced(db, notifier, auth.supplierId, order);
    if (!replayed && order.assignedTo) await notify.orderAssigned(notifier, order.assignedTo.id, order);
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
    const auth = requireOperator(req);
    const { id } = parse(idParams, req.params);
    const input = parse(deliverOrderSchema, req.body);
    const result = await deliverOrder(db, auth, id, input);
    if (!result.replayed) {
      await notify.orderDelivered(db, notifier, auth.supplierId, result.order, result.storeBalance, input.items);
    }
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  /** Owner gives an open order to a member of staff (or takes it back with staffId null). */
  app.post('/api/orders/:id/assign', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(idParams, req.params);
    const { staffId } = parse(assignOrderSchema, req.body);
    const order = await db.order.findFirst({ where: { id, supplierId: auth.supplierId }, select: { status: true, assignedToId: true } });
    if (!order) throw notFound('Order');
    if (!(['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED'] as string[]).includes(order.status)) {
      throw validationError('Only orders still to be delivered can be given to staff.');
    }
    if (staffId) {
      const staff = await db.user.findFirst({ where: { id: staffId, supplierId: auth.supplierId, role: 'STAFF', active: true }, select: { id: true } });
      if (!staff) throw validationError('Choose an active member of staff.', { staffId: 'Not found' });
    }
    await db.order.update({ where: { id }, data: { assignedToId: staffId } });
    const dto = await loadOrderDto(db, { supplierId: auth.supplierId }, id);
    if (staffId && staffId !== order.assignedToId) await notify.orderAssigned(notifier, staffId, dto);
    return dto;
  });

  app.post('/api/orders/:id/cancel', async (req) => {
    const auth = requireOwnerOrStore(req);
    const { id } = parse(idParams, req.params);
    const input = parse(cancelOrderSchema, req.body ?? {});
    const order = await cancelOrder(db, auth, id, input);
    await notify.orderCancelled(notifier, auth.supplierId, order, auth.role === 'STORE');
    return order;
  });
}
