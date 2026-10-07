import { zonedDateKey, type OrderListItem } from '@wd/shared';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { OrderStatusBadge, PaymentBadge } from '../../components/ui/Badge';
import { ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { FilterChips } from '../../components/ui/Segmented';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useDebounce } from '../../hooks/useDebounce';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { formatDate, formatDateTime, formatTime } from '../../utils/format';
import { useSession } from '../auth/session';
import { StoreSearchBox } from '../stores/StorePicker';
import { useOrders, type OrderListParams } from './api';

type Tab = 'today' | 'open' | 'all';
const TABS: Tab[] = ['today', 'open', 'all'];
const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'];

export default function OrdersPage() {
  const tz = useTimezone();
  const format = useMoney();
  const { user } = useSession();
  const isSupplier = user.role === 'SUPPLIER';
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab') as Tab | null;
  const tab: Tab = fromUrl && TABS.includes(fromUrl) ? fromUrl : isSupplier ? 'today' : 'all';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim());

  const query: OrderListParams =
    tab === 'today' ? { date: zonedDateKey(new Date(), tz) } : tab === 'open' ? { status: 'OPEN' } : {};
  const orders = useOrders({ ...query, search: debounced || undefined });
  const rows = orders.data?.pages.flatMap((p) => p.items) ?? [];

  const subtitle = (o: OrderListItem) => {
    const when =
      OPEN.includes(o.status) && o.deliveryDate
        ? `for ${formatDate(o.deliveryDate, tz)}`
        : tab === 'today'
          ? formatTime(o.orderDate, tz)
          : formatDateTime(o.orderDate, tz);
    const who = isSupplier && o.assignedTo && OPEN.includes(o.status) ? ` · ${o.assignedTo.name}` : '';
    return `#${o.orderNumber} · ${o.totalQuantity} can${o.totalQuantity === 1 ? '' : 's'} · ${when}${who}`;
  };

  return (
    <>
      <PageHeader title={isSupplier ? 'Orders' : 'My orders'} />
      <PageBody>
        <div className="flex flex-col gap-3">
          {isSupplier ? <StoreSearchBox value={search} onChange={setSearch} placeholder="Store or order #" /> : null}
          <FilterChips<Tab>
            label="Show orders"
            value={tab}
            onChange={setTab}
            options={
              isSupplier
                ? [
                    { value: 'today', label: 'Today' },
                    { value: 'open', label: 'Pending' },
                    { value: 'all', label: 'All' },
                  ]
                : [
                    { value: 'all', label: 'All' },
                    { value: 'open', label: 'Not delivered yet' },
                  ]
            }
          />
        </div>
        {orders.isPending ? (
          <ListSkeleton rows={6} />
        ) : orders.isError ? (
          <ErrorRetry message={errorMessage(orders.error)} onRetry={() => void orders.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-6" />}
            title={debounced ? 'No matching orders' : tab === 'today' ? 'No orders today' : tab === 'open' ? 'Nothing pending' : 'No orders yet'}
            action={
              <Link to="/orders/new" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
                {isSupplier ? 'Create order' : 'Order water'}
              </Link>
            }
          />
        ) : (
          <>
            <ListCard>
              {rows.map((o) => {
                const done = o.status === 'DELIVERED' || o.status === 'PARTIALLY_DELIVERED';
                return (
                  <ListRow
                    key={o.id}
                    to={`/orders/${o.id}`}
                    title={isSupplier ? o.storeName : format(o.total)}
                    subtitle={subtitle(o)}
                    trailing={
                      <span className="flex flex-col items-end gap-1">
                        {isSupplier ? <span className="font-semibold text-ink tabular">{format(o.total)}</span> : null}
                        {done ? <PaymentBadge status={o.paymentStatus} /> : <OrderStatusBadge status={o.status} />}
                      </span>
                    }
                  />
                );
              })}
            </ListCard>
            <LoadMore hasMore={Boolean(orders.hasNextPage)} loading={orders.isFetchingNextPage} onLoad={() => void orders.fetchNextPage()} />
          </>
        )}
      </PageBody>
    </>
  );
}
