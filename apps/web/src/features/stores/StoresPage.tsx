import { Plus, Store as StoreIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { FilterChips } from '../../components/ui/Segmented';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { BalanceText } from '../../components/ui/Stat';
import { useDebounce } from '../../hooks/useDebounce';
import { useMoney } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { formatPhone } from '@wd/shared';
import { useSession } from '../auth/session';
import { useStores, type StoreFilter } from './api';
import { StoreSearchBox } from './StorePicker';

const FILTERS: { value: StoreFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owes', label: 'Owes money' },
  { value: 'cans', label: 'Has cans' },
  { value: 'inactive', label: 'Inactive' },
];

export default function StoresPage() {
  // Staff can't add stores or see inactive ones.
  const isOwner = useSession().user.role === 'SUPPLIER';
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('filter');
  const filter: StoreFilter = FILTERS.some((f) => f.value === fromUrl)
    ? (fromUrl as StoreFilter)
    : 'all';
  const setFilter = (value: StoreFilter) =>
    setParams(value === 'all' ? {} : { filter: value }, { replace: true });
  const debounced = useDebounce(search.trim());
  const stores = useStores({ search: debounced, filter });
  const format = useMoney();
  const items = stores.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Stores"
        action={
          !isOwner ? undefined : (
            <Link
              to="/stores/new"
              className="flex h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-brand-700 hover:bg-brand-50"
            >
              <Plus className="size-5" aria-hidden />
              Add
            </Link>
          )
        }
      />
      <PageBody>
        <div className="flex flex-col gap-3">
          <StoreSearchBox value={search} onChange={setSearch} />
          <FilterChips
            label="Filter stores"
            value={filter}
            onChange={setFilter}
            options={isOwner ? FILTERS : FILTERS.filter((f) => f.value !== 'inactive')}
          />
        </div>

        {stores.isPending ? (
          <ListSkeleton rows={6} />
        ) : stores.isError ? (
          <ErrorRetry message={errorMessage(stores.error)} onRetry={() => void stores.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<StoreIcon className="size-6" />}
            title={
              debounced
                ? 'No matching stores'
                : filter === 'owes'
                  ? 'Nobody owes you money'
                  : filter === 'cans'
                    ? 'No cans are out with stores'
                    : filter === 'inactive'
                      ? 'No inactive stores'
                      : 'No stores yet'
            }
            description={
              !debounced && filter === 'all'
                ? isOwner
                  ? 'Add the shops you deliver water to.'
                  : 'The owner adds the stores you deliver to.'
                : undefined
            }
            action={
              isOwner && !debounced && filter === 'all' ? (
                <Link
                  to="/stores/new"
                  className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white"
                >
                  Add store
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
                  to={`/stores/${s.id}`}
                  title={s.name}
                  subtitle={
                    [
                      s.ownerName,
                      s.phone ? formatPhone(s.phone) : null,
                      s.cansOutstanding ? `${s.cansOutstanding} cans` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                  trailing={<BalanceText balance={s.balance} format={format} className="text-sm" />}
                />
              ))}
            </ListCard>
            <LoadMore
              hasMore={Boolean(stores.hasNextPage)}
              loading={stores.isFetchingNextPage}
              onLoad={() => void stores.fetchNextPage()}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
