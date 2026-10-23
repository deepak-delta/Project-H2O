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
import { useOrders, useWeekPlan, type OrderListParams } from './api';
import { AssignedNote, AssignSheet, SelectionBar, SelectMark } from './BulkAssign';
import { matchesSearch, WeekView } from './WeekView';

type Tab = 'today' | 'open' | 'week' | 'all';
const TABS: Tab[] = ['today', 'open', 'week', 'all'];
const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'];

export default function OrdersPage() {
  const tz = useTimezone();
  const format = useMoney();
  const { user } = useSession();
  const isSupplier = user.role === 'SUPPLIER';
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab') as Tab | null;
  const tab: Tab = fromUrl && TABS.includes(fromUrl) && (isSupplier || fromUrl !== 'week') ? fromUrl : isSupplier ? 'today' : 'all';
  const setTab = (t: Tab) => {
    setSelecting(false);
    setParams({ tab: t }, { replace: true });
  };
  // Choosing orders to give to staff, on Pending and This week.
  const canSelect = isSupplier && (tab === 'open' || tab === 'week');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const choosing = canSelect && selecting;
  const toggle = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const startSelecting = () => {
    setSelected(new Set());
    setSelecting(true);
  };
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim());

  const query: OrderListParams =
    tab === 'today' ? { date: zonedDateKey(new Date(), tz) } : tab === 'open' ? { status: 'OPEN' } : {};
  const orders = useOrders({ ...query, search: debounced || undefined }, tab !== 'week');
  const week = useWeekPlan(tab === 'week');
  const rows = orders.data?.pages.flatMap((p) => p.items) ?? [];
  // Everything that can be chosen on the screen now (search included).
  const choosable =
    tab === 'week'
      ? week.data
        ? [...week.data.late, ...week.data.days.flatMap((d) => d.orders)].filter((o) => matchesSearch(o, search)).map((o) => o.id)
        : []
      : rows.map((o) => o.id);
  const chosen = choosable.filter((id) => selected.has(id));

  const subtitle = (o: OrderListItem) => {
    const when =
      OPEN.includes(o.status) && o.deliveryDate
        ? `for ${formatDate(o.deliveryDate, tz)}`
        : tab === 'today'
          ? formatTime(o.orderDate, tz)
          : formatDateTime(o.orderDate, tz);
    // Early in the line: on a narrow phone the end gets cut off.
    const regular = isSupplier && o.regular ? ' · Regular' : '';
    return `#${o.orderNumber}${regular} · ${o.totalQuantity} can${o.totalQuantity === 1 ? '' : 's'} · ${when}`;
  };

  return (
    <>
      <PageHeader
        title={isSupplier ? 'Orders' : 'My orders'}
        action={
          canSelect ? (
            <button
              type="button"
              onClick={() => (choosing ? setSelecting(false) : startSelecting())}
              className="-mr-2 h-11 rounded-xl px-3 text-[15px] font-semibold text-brand-700 hover:bg-brand-50"
            >
              {choosing ? 'Cancel' : 'Select'}
            </button>
          ) : undefined
        }
      />
      <PageBody>
        <div className="flex flex-col gap-3">
          {isSupplier ? <StoreSearchBox value={search} onChange={setSearch} placeholder="Client or order #" /> : null}
          <FilterChips<Tab>
            label="Show orders"
            value={tab}
            onChange={setTab}
            options={
              isSupplier
                ? [
                    { value: 'today', label: 'Today' },
                    { value: 'open', label: 'Pending' },
                    { value: 'week', label: 'This week' },
                    { value: 'all', label: 'All' },
                  ]
                : [
                    { value: 'all', label: 'All' },
                    { value: 'open', label: 'Not delivered yet' },
                  ]
            }
          />
        </div>
        {tab === 'week' ? (
          week.isPending ? (
            <ListSkeleton rows={6} />
          ) : week.isError ? (
            <ErrorRetry message={errorMessage(week.error)} onRetry={() => void week.refetch()} />
          ) : (
            <WeekView plan={week.data} search={search} selection={choosing ? { selected, toggle } : undefined} />
          )
        ) : orders.isPending ? (
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
                    {...(choosing
                      ? { onClick: () => toggle([o.id]), leading: <SelectMark checked={selected.has(o.id)} /> }
                      : { to: `/orders/${o.id}` })}
                    title={isSupplier ? o.storeName : format(o.total)}
                    subtitle={subtitle(o)}
                    note={isSupplier ? <AssignedNote order={o} /> : undefined}
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
        {/* Room for the selection bar so the last row isn't hidden under it. */}
        {choosing ? <div className="h-20" aria-hidden /> : null}
      </PageBody>
      {choosing ? (
        <SelectionBar
          count={chosen.length}
          allSelected={choosable.length > 0 && chosen.length === choosable.length}
          onToggleAll={() => setSelected(chosen.length === choosable.length ? new Set() : new Set(choosable))}
          onAssign={() => setAssigning(true)}
        />
      ) : null}
      <AssignSheet
        orderIds={chosen}
        open={assigning}
        onClose={() => setAssigning(false)}
        onDone={() => {
          setAssigning(false);
          setSelecting(false);
        }}
      />
    </>
  );
}
