import { formatPhone } from '@wd/shared';
import { Boxes } from 'lucide-react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { formatDate } from '../../utils/format';
import { useHolders } from './api';

/** "Who has my cans?" — stores ordered by how many cans they hold. */
export default function HoldersPage() {
  const holders = useHolders();
  const tz = useTimezone();
  const total = holders.data?.reduce((s, h) => s + h.quantity, 0) ?? 0;

  return (
    <>
      <PageHeader title="Cans with stores" subtitle={holders.data ? `${total} cans at ${holders.data.length} stores` : undefined} back="/inventory" />
      <PageBody>
        {holders.isPending ? (
          <ListSkeleton rows={6} />
        ) : holders.isError ? (
          <ErrorRetry message={errorMessage(holders.error)} onRetry={() => void holders.refetch()} />
        ) : holders.data.length === 0 ? (
          <EmptyState icon={<Boxes className="size-6" />} title="No cans are out with stores" />
        ) : (
          <ListCard>
            {holders.data.map((h) => (
              <ListRow
                key={h.storeId}
                to={`/stores/${h.storeId}`}
                title={h.storeName}
                subtitle={[h.phone ? formatPhone(h.phone) : null, h.lastDeliveryAt ? `last delivery ${formatDate(h.lastDeliveryAt, tz)}` : null]
                  .filter(Boolean)
                  .join(' · ') || undefined}
                trailing={<span className="text-lg font-semibold tabular">{h.quantity}</span>}
              />
            ))}
          </ListCard>
        )}
      </PageBody>
    </>
  );
}
