import { Search, Store as StoreIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { BalanceText } from '../../components/ui/Stat';
import { useDebounce } from '../../hooks/useDebounce';
import { useMoney } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import type { StoreListItem } from '@wd/shared';
import { useOnline } from '../../hooks/useOnline';
import { cachedStores, useStores } from './api';

function searchLocally(stores: StoreListItem[], text: string): StoreListItem[] {
  const q = text.toLowerCase();
  const digits = text.replace(/\D/g, '');
  const active = stores.filter((s) => s.status === 'ACTIVE');
  if (!q) return active;
  return active.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.ownerName?.toLowerCase().includes(q) ?? false) ||
      (digits.length >= 3 && (s.phone?.includes(digits) ?? false)),
  );
}

export function StoreSearchBox({
  value,
  onChange,
  autoFocus,
  placeholder = 'Store, owner or phone',
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
      <Search className="size-5 shrink-0 text-muted" aria-hidden />
      <span className="sr-only">Search</span>
      <input
        type="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted/70"
      />
    </label>
  );
}

/** Store chooser for new orders: most recently served stores first, instant search. */
export function StorePicker({ onPick }: { onPick: (storeId: string) => void }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim());
  const online = useOnline();
  const queryClient = useQueryClient();
  const stores = useStores({ search: debounced, sort: 'recent' });
  const format = useMoney();
  // Offline: search the stores already saved on this phone instead of waiting for the server.
  const offline = !online && !stores.data;
  const items = offline ? searchLocally(cachedStores(queryClient), debounced) : (stores.data?.pages.flatMap((p) => p.items) ?? []);

  return (
    <div className="flex flex-col gap-3">
      <StoreSearchBox value={search} onChange={setSearch} />
      {stores.isPending && !offline ? (
        <ListSkeleton rows={5} />
      ) : stores.isError ? (
        <ErrorRetry message={errorMessage(stores.error)} onRetry={() => void stores.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<StoreIcon className="size-6" />}
          title={debounced ? 'No matching stores' : offline ? 'No stores saved on this phone' : 'No stores yet'}
          description={debounced ? 'Try a different name or number.' : 'Add the stores you deliver to.'}
          action={
            <Link to="/stores/new" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
              Add store
            </Link>
          }
        />
      ) : (
        <>
          <ListCard>
            {items.map((s) => (
              <ListRow
                key={s.id}
                onClick={() => onPick(s.id)}
                title={s.name}
                subtitle={[s.ownerName, s.cansOutstanding ? `${s.cansOutstanding} cans` : null].filter(Boolean).join(' · ') || undefined}
                trailing={<BalanceText balance={s.balance} format={format} className="text-sm" />}
              />
            ))}
          </ListCard>
          <LoadMore hasMore={Boolean(stores.hasNextPage)} loading={stores.isFetchingNextPage} onLoad={() => void stores.fetchNextPage()} />
        </>
      )}
    </div>
  );
}
