import { addDays, type OrderListItem, type UpcomingRegular, type WeekPlan } from '@wd/shared';
import { CalendarCheck, Repeat } from 'lucide-react';
import { Badge, OrderStatusBadge } from '../../components/ui/Badge';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { formatDate } from '../../utils/format';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Today · Fri 23 Oct", "Tomorrow · Sat 24 Oct", "Mon 26 Oct". */
function dayLabel(date: string, today: string): string {
  const short = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  if (date === today) return `Today · ${short}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${short}`;
  return short;
}

function matches(text: string, search: string): boolean {
  const q = search.trim().toLowerCase().replace(/^#/, '');
  return !q || text.toLowerCase().includes(q);
}

/**
 * Pending deliveries for the next 7 days, day by day, with the regular deliveries that will be
 * made on those days, and any already late at the top. Search filters by client or order #.
 */
export function WeekView({ plan, search }: { plan: WeekPlan; search: string }) {
  const tz = useTimezone();
  const format = useMoney();
  const findOrders = (orders: OrderListItem[]) => orders.filter((o) => matches(`${o.storeName} ${o.orderNumber}`, search));
  const findRegulars = (rows: UpcomingRegular[]) => rows.filter((r) => matches(r.storeName, search));

  const late = findOrders(plan.late);
  const days = plan.days.map((d) => ({ ...d, orders: findOrders(d.orders), regulars: findRegulars(d.regulars) }));
  const total = late.length + days.reduce((n, d) => n + d.orders.length + d.regulars.length, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={<CalendarCheck className="size-6" />}
        title={search.trim() ? 'No matching deliveries' : 'Nothing due this week'}
        description={search.trim() ? undefined : 'No pending orders or regular deliveries in the next 7 days.'}
      />
    );
  }

  const orderRow = (o: OrderListItem) => (
    <ListRow
      key={o.id}
      to={`/orders/${o.id}`}
      title={o.storeName}
      subtitle={[
        `#${o.orderNumber}${o.regular ? ' · Regular' : ''} · ${plural(o.totalQuantity, 'can')}`,
        o.assignedTo?.name ?? null,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={
        <span className="flex flex-col items-end gap-1">
          <span className="font-semibold text-ink tabular">{format(o.total)}</span>
          <OrderStatusBadge status={o.status} />
        </span>
      }
    />
  );

  return (
    <>
      {late.length > 0 ? (
        <section aria-label="Late deliveries">
          <DayHeading title="Late" detail={summary(late.length, late.reduce((n, o) => n + o.totalQuantity, 0))} tone="bad" />
          <ListCard>
            {late.map((o) => (
              <ListRow
                key={o.id}
                to={`/orders/${o.id}`}
                title={o.storeName}
                subtitle={`#${o.orderNumber} · ${plural(o.totalQuantity, 'can')} · was due ${formatDate(o.deliveryDate ?? o.orderDate, tz)}`}
                trailing={<Badge tone="bad">Late</Badge>}
              />
            ))}
          </ListCard>
        </section>
      ) : null}

      {days.map((d) => {
        const count = d.orders.length + d.regulars.length;
        // While searching, days with no match are hidden; otherwise every day shows.
        if (count === 0 && search.trim()) return null;
        const cans = d.orders.reduce((n, o) => n + o.totalQuantity, 0) + d.regulars.reduce((n, r) => n + r.totalQuantity, 0);
        return (
          <section key={d.date} aria-label={dayLabel(d.date, plan.from)}>
            <DayHeading title={dayLabel(d.date, plan.from)} detail={count ? summary(count, cans) : 'Nothing due'} />
            {count === 0 ? null : (
              <ListCard>
                {d.orders.map(orderRow)}
                {d.regulars.map((r) => (
                  <ListRow
                    key={`${r.scheduleId}:${r.date}`}
                    to={`/stores/${r.storeId}/schedule`}
                    title={r.storeName}
                    subtitle={[plural(r.totalQuantity, 'can'), r.assignedTo?.name ?? null].filter(Boolean).join(' · ')}
                    trailing={
                      <Badge tone="brand">
                        <Repeat className="mr-1 size-3.5" aria-hidden />
                        Regular
                      </Badge>
                    }
                  />
                ))}
              </ListCard>
            )}
          </section>
        );
      })}
      {days.some((d) => d.regulars.length > 0) ? (
        <Card className="px-4 py-3 text-sm text-muted">Regular deliveries become orders on their day, at 6 AM.</Card>
      ) : null}
    </>
  );
}

const summary = (deliveries: number, cans: number) => `${deliveries} deliver${deliveries === 1 ? 'y' : 'ies'} · ${plural(cans, 'can')}`;

function DayHeading({ title, detail, tone }: { title: string; detail: string; tone?: 'bad' }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
      <h2 className={tone === 'bad' ? 'text-[15px] font-semibold text-bad' : 'text-[15px] font-semibold text-ink'}>{title}</h2>
      <p className="text-[13px] text-muted tabular">{detail}</p>
    </div>
  );
}
