import { formatPhone } from '@wd/shared';
import { ChevronRight, Droplets, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { OrderStatusBadge } from '../../components/ui/Badge';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { Skeleton } from '../../components/ui/Skeleton';
import { BalanceText } from '../../components/ui/Stat';
import { useStoreHome } from '../../features/store-app/api';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { formatDate, formatDateTime } from '../../utils/format';

const METHOD = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank', OTHER: 'Other' } as const;

/** Store owner's home: one big "Order water" button, then what they owe and hold. */
export default function StoreHomePage() {
  const home = useStoreHome();
  const format = useMoney();
  const tz = useTimezone();

  if (home.isPending) {
    return (
      <div className="space-y-4 p-4" aria-busy>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (home.isError) {
    return (
      <PageBody>
        <ErrorRetry message={errorMessage(home.error)} onRetry={() => void home.refetch()} />
      </PageBody>
    );
  }
  const h = home.data;

  return (
    <>
      <PageHeader title={h.store.name} subtitle={`Water from ${h.supplier.businessName}`} />
      <PageBody>
        <Link
          to="/orders/new"
          className="flex min-h-16 items-center justify-center gap-2.5 rounded-2xl bg-brand-700 text-lg font-semibold text-white shadow-sm active:bg-brand-800"
        >
          <Droplets className="size-6" aria-hidden />
          Order water
        </Link>

        <Card className="grid grid-cols-2 divide-x divide-line">
          <Link to="/statement" className="block p-4">
            <span className="block text-[13px] text-muted">Balance</span>
            <span className="mt-0.5 block text-xl">
              <BalanceText balance={h.balance} format={format} />
            </span>
            <span className="mt-1 flex items-center text-xs font-medium text-brand-700">
              Statement <ChevronRight className="size-4" aria-hidden />
            </span>
          </Link>
          <Link to="/statement?tab=cans" className="block p-4">
            <span className="block text-[13px] text-muted">Cans with you</span>
            <span className="mt-0.5 block text-xl font-semibold text-ink tabular">{h.cansOutstanding}</span>
            <span className="mt-1 block text-xs text-muted">
              {h.lastDelivery ? `Last delivery ${formatDate(h.lastDelivery.deliveredAt, tz)}` : 'No deliveries yet'}
            </span>
          </Link>
        </Card>

        {h.openOrders.length > 0 ? (
          <section>
            <SectionTitle>On the way</SectionTitle>
            <ListCard>
              {h.openOrders.map((o) => (
                <ListRow
                  key={o.id}
                  to={`/orders/${o.id}`}
                  title={`${o.totalQuantity} can${o.totalQuantity === 1 ? '' : 's'} · #${o.orderNumber}`}
                  subtitle={o.deliveryDate ? `For ${formatDate(o.deliveryDate, tz)}` : `Ordered ${formatDateTime(o.orderDate, tz)}`}
                  trailing={<OrderStatusBadge status={o.status} />}
                />
              ))}
            </ListCard>
          </section>
        ) : null}

        <section>
          <SectionTitle action={<Link to="/orders" className="text-sm font-semibold text-brand-700">All</Link>}>Recent orders</SectionTitle>
          {h.recentOrders.length === 0 ? (
            <Card className="px-4 py-3.5 text-sm text-muted">No orders yet. Tap “Order water” to place your first.</Card>
          ) : (
            <ListCard>
              {h.recentOrders.map((o) => (
                <ListRow
                  key={o.id}
                  to={`/orders/${o.id}`}
                  title={`${o.totalQuantity} can${o.totalQuantity === 1 ? '' : 's'} · ${format(o.total)}`}
                  subtitle={`#${o.orderNumber} · ${formatDate(o.orderDate, tz)}`}
                  trailing={<OrderStatusBadge status={o.status} />}
                />
              ))}
            </ListCard>
          )}
        </section>

        {h.recentPayments.length > 0 ? (
          <section>
            <SectionTitle action={<Link to="/payments" className="text-sm font-semibold text-brand-700">All</Link>}>Recent payments</SectionTitle>
            <ListCard>
              {h.recentPayments.map((p) => (
                <ListRow
                  key={p.id}
                  title={METHOD[p.method]}
                  subtitle={formatDateTime(p.paymentDate, tz)}
                  trailing={<span className={`font-semibold tabular ${p.reversed ? 'text-muted line-through' : 'text-ok'}`}>{format(p.amount)}</span>}
                />
              ))}
            </ListCard>
          </section>
        ) : null}

        {h.supplier.phone ? (
          <a
            href={`tel:${h.supplier.phone}`}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface font-semibold text-ink"
          >
            <Phone className="size-5" aria-hidden />
            Call {h.supplier.businessName} · {formatPhone(h.supplier.phone)}
          </a>
        ) : null}
      </PageBody>
    </>
  );
}
