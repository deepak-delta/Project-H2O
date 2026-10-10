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
import { toMinor, type StoreListItem } from '@wd/shared';
import { useOnline } from '../../hooks/useOnline';
import { useSession } from '../auth/session';
import { cachedStores, useStores, type StoreFilter } from './api';
import { clientTypeLabel } from './clientType';

/**
 * Instant search over clients already on the phone: name, owner, type or phone digits. Used
 * on every keystroke (and offline) so results follow the typing without waiting for the server.
 */
export function searchLocally(stores: StoreListItem[], text: string, filter: StoreFilter = 'all'): StoreListItem[] {
  const q = text.trim().toLowerCase();
  const digits = text.replace(/\D/g, '');
  const inFilter = stores.filter((s) =>
    filter === 'inactive'
      ? s.status === 'INACTIVE'
      : s.status === 'ACTIVE' && (filter !== 'owes' || toMinor(s.balance) > 0) && (filter !== 'cans' || s.cansOutstanding > 0),
  );
  if (!q) return inFilter;
  return inFilter.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.ownerName?.toLowerCase().includes(q) ?? false) ||
      clientTypeLabel(s).toLowerCase().includes(q) ||
      (digits.length >= 3 && (s.phone?.includes(digits) ?? false)),
  );
}

export function StoreSearchBox({
  value,
  onChange,
  autoFocus,
  placeholder = 'Client, owner or phone',
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
        // Some keyboards (e.g. English–Hindi on iPhone) hold a word as "being typed" until it is
        // finished; follow it letter by letter anyway.
        onCompositionUpdate={(e) => onChange(e.currentTarget.value)}
        autoCorrect="off"
        autoCapitalize="none"
        className="h-full w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted/70"
      />
    </label>
  );
}

/** Store chooser for new orders: most recently served stores first, instant search. */
export function StorePicker({ onPick }: { onPick: (storeId: string) => void }) {
  // Only the owner adds clients; staff deliver to the ones the owner has added.
  const isOwner = useSession().user.role === 'SUPPLIER';
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim());
  const online = useOnline();
  const queryClient = useQueryClient();
  const stores = useStores({ search: debounced, sort: 'recent' });
  const format = useMoney();
  // Offline: search the clients already saved on this phone instead of waiting for the server.
  const offline = !online && !stores.data;
  // While the server is still answering for what's typed, show instant matches from the phone.
  const saved = cachedStores(queryClient);
  const catchingUp = (search.trim() !== debounced || stores.isPlaceholderData) && saved.length > 0;
  const items =
    offline || (catchingUp && search.trim())
      ? searchLocally(saved, search)
      : (stores.data?.pages.flatMap((p) => p.items) ?? []);

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
          title={debounced ? 'No matching clients' : offline ? 'No clients saved on this phone' : 'No clients yet'}
          description={
            debounced
              ? 'Try a different name or number.'
              : isOwner
                ? 'Add the clients you deliver to.'
                : 'The owner adds the clients you deliver to.'
          }
          action={
            isOwner ? (
              <Link to="/stores/new" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
                Add client
              </Link>
            ) : undefined
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
