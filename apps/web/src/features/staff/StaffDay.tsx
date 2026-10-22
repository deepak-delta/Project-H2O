import { mapsUrl, type StaffActivity, type StaffTodayDto } from '@wd/shared';
import { Navigation, Receipt, Truck } from 'lucide-react';
import { Link } from 'react-router';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Stat } from '../../components/ui/Stat';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { formatTime } from '../../utils/format';
import { CATEGORY_LABEL, METHOD_LABEL } from '../cashflow/labels';

/**
 * One member of staff's day: totals, cash they should hand over, orders still to deliver and
 * what they did. Staff see their own (today only); the owner can open anyone's.
 */
export function StaffDay({ day, self }: { day: StaffTodayDto; self: boolean }) {
  const format = useMoney();
  const tz = useTimezone();
  const collectedOther = Object.entries(day.collected.byMethod)
    .filter(([method, amount]) => method !== 'CASH' && amount !== '0.00')
    .map(([method, amount]) => `${METHOD_LABEL[method as keyof typeof METHOD_LABEL]} ${format(amount)}`);

  return (
    <>
      <Card className="flex items-center justify-between gap-3 border-brand-200 bg-brand-50 p-4">
        {self ? (
          <div className="min-w-0">
            <p className="text-[13px] text-ink-2">Cash to hand over</p>
            <p className="text-2xl font-semibold text-ink tabular">{format(day.cashInHand)}</p>
            <p className="text-xs text-muted">Cash taken {format(day.collected.byMethod.CASH)} − cash spent</p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-[13px] text-ink-2">Staff expense today</p>
            <p className="text-2xl font-semibold text-ink tabular">{format(day.expenses)}</p>
            <p className="text-xs text-muted">Cash to hand over {format(day.cashInHand)}</p>
          </div>
        )}
      </Card>

      <section>
        <SectionTitle>Today</SectionTitle>
        <Card className="grid grid-cols-2 gap-2 p-2">
          <Stat label="Deliveries" value={day.deliveries} />
          <Stat label="Cans delivered" value={day.cansDelivered} hint={`${day.emptiesCollected} empties back`} />
          <Stat label="Collected" value={format(day.collected.total)} hint={collectedOther.join(' · ') || undefined} />
          <Stat label="Expenses" value={format(day.expenses)} />
        </Card>
      </section>

      <section>
        <SectionTitle>{self ? 'To deliver' : 'Orders given to them'}</SectionTitle>
        {day.assignedOrders.length === 0 ? (
          <Card className="px-4 py-3 text-[15px] text-muted">{self ? 'No orders waiting for you.' : 'Nothing waiting.'}</Card>
        ) : (
          <ListCard>
            {day.assignedOrders.map((o) => {
              const map = mapsUrl({ address: o.storeAddress, mapLink: o.storeMapLink });
              return (
                <div key={o.id} className="flex items-center">
                  <div className="min-w-0 flex-1">
                    <ListRow
                      to={self ? `/orders/${o.id}/deliver` : `/orders/${o.id}`}
                      title={o.storeName}
                      subtitle={[`#${o.orderNumber} · ${o.totalQuantity} can${o.totalQuantity === 1 ? '' : 's'}`, o.storeAddress].filter(Boolean).join(' · ')}
                      trailing={
                        self ? (
                          <span className="flex items-center gap-1 text-sm font-semibold text-brand-700">
                            <Truck className="size-4" aria-hidden /> Deliver
                          </span>
                        ) : undefined
                      }
                    />
                  </div>
                  {map ? (
                    <a
                      href={map}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${o.storeName} in Maps`}
                      className="mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-brand-700 hover:bg-brand-50"
                    >
                      <Navigation className="size-5" />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </ListCard>
        )}
      </section>

      <section>
        <SectionTitle>{self ? 'What you did today' : 'What they did today'}</SectionTitle>
        {day.activity.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="Nothing yet today"
            description={self ? 'Deliveries, payments and expenses you record today show here.' : undefined}
            action={
              self ? (
                <Link to="/orders/new" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
                  New delivery
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ListCard>
            {day.activity.map((a) => (
              <ActivityRow key={`${a.kind}-${a.id}`} a={a} time={formatTime(a.at, tz)} format={format} />
            ))}
          </ListCard>
        )}
      </section>
    </>
  );
}

function ActivityRow({ a, time, format }: { a: StaffActivity; time: string; format: (v: string) => string }) {
  switch (a.kind) {
    case 'DELIVERY':
      return (
        <ListRow
          to={`/orders/${a.orderId}`}
          title={a.storeName}
          subtitle={`${time} · Delivered ${a.cans} can${a.cans === 1 ? '' : 's'}${a.empties ? ` · ${a.empties} empties` : ''}`}
          trailing={<span className="font-semibold text-ink tabular">{format(a.amount)}</span>}
        />
      );
    case 'PAYMENT':
      return (
        <ListRow
          title={a.storeName}
          subtitle={`${time} · Payment · ${METHOD_LABEL[a.method]}`}
          trailing={<span className="font-semibold text-ok tabular">+{format(a.amount)}</span>}
        />
      );
    case 'EMPTIES':
      return <ListRow title={a.storeName} subtitle={`${time} · ${a.cans} empties collected`} />;
    case 'EXPENSE':
      return (
        <ListRow
          title={CATEGORY_LABEL[a.category as keyof typeof CATEGORY_LABEL] ?? 'Expense'}
          subtitle={[time, a.description, METHOD_LABEL[a.method]].filter(Boolean).join(' · ')}
          trailing={<span className="font-semibold text-bad tabular">−{format(a.amount)}</span>}
        />
      );
  }
}
