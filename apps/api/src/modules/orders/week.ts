import { addDays, zonedDateKey, zonedDayRangeForKey, type WeekPlan } from '@wd/shared';
import { getBusinessSettings } from '../../lib/business';
import type { Db } from '../../lib/db';
import { upcomingRegulars } from '../schedules/schedule';
import { orderListInclude, toOrderListItem } from './order-dto';

const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'] as const;
const DAYS = 7;
/** Far more open orders than a business has at once. */
const MAX_ORDERS = 500;

/**
 * The owner's week: every order not delivered yet that is due by the end of the 7th day
 * (on its wanted day, or the day it was placed if none), grouped by day, plus the regular
 * deliveries that will be made on those days. Earlier ones are listed as late.
 */
export async function weekPlan(db: Db, supplierId: string, now = new Date()): Promise<WeekPlan> {
  const { timezone } = await getBusinessSettings(db, supplierId);
  const today = zonedDateKey(now, timezone);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const end = zonedDayRangeForKey(days.at(-1)!, timezone).end;

  const [orders, regulars] = await Promise.all([
    db.order.findMany({
      where: {
        supplierId,
        status: { in: [...OPEN_STATUSES] },
        OR: [{ deliveryDate: { lt: end } }, { deliveryDate: null, orderDate: { lt: end } }],
      },
      include: orderListInclude,
      orderBy: [{ deliveryDate: 'asc' }, { orderDate: 'asc' }, { orderNumber: 'asc' }],
      take: MAX_ORDERS,
    }),
    upcomingRegulars(db, supplierId, days),
  ]);

  const dueDay = (o: (typeof orders)[number]) => zonedDateKey(o.deliveryDate ?? o.orderDate, timezone);
  const late = orders.filter((o) => dueDay(o) < today);
  return {
    from: today,
    to: days.at(-1)!,
    late: late.map(toOrderListItem),
    days: days.map((date) => ({
      date,
      orders: orders.filter((o) => dueDay(o) === date).map(toOrderListItem),
      regulars: regulars.filter((r) => r.date === date),
    })),
  };
}
