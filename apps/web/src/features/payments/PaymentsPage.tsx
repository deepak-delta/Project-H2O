import { useInfiniteQuery } from '@tanstack/react-query';
import type { Page, PaymentDto } from '@wd/shared';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { api, errorMessage } from '../../services/api';
import { qk } from '../../services/queryKeys';
import { formatDateTime } from '../../utils/format';
import { useSession } from '../auth/session';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { ReversePaymentSheet } from '../orders/OrderSheets';

const METHOD = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank', OTHER: 'Other' } as const;

export function usePayments() {
  return useInfiniteQuery({
    queryKey: qk.payments({}),
    queryFn: ({ pageParam }) => api.get<Page<PaymentDto>>(`/payments${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Every payment received, newest first. Used by both suppliers and stores (scoped server-side). */
export default function PaymentsPage() {
  const payments = usePayments();
  const format = useMoney();
  const tz = useTimezone();
  const { user } = useSession();
  const rows = payments.data?.pages.flatMap((p) => p.items) ?? [];
  const isSupplier = user.role === 'SUPPLIER';
  const [selected, setSelected] = useState<PaymentDto | null>(null);
  const [reversing, setReversing] = useState<PaymentDto | null>(null);

  return (
    <>
      <PageHeader title="Payments" back={isSupplier ? '/more' : undefined} />
      <PageBody>
        {payments.isPending ? (
          <ListSkeleton rows={6} />
        ) : payments.isError ? (
          <ErrorRetry message={errorMessage(payments.error)} onRetry={() => void payments.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Wallet className="size-6" />} title="No payments yet" />
        ) : (
          <>
            <ListCard>
              {rows.map((p) => (
                <ListRow
                  key={p.id}
                  onClick={isSupplier ? () => setSelected(p) : undefined}
                  title={isSupplier ? p.storeName : METHOD[p.method]}
                  subtitle={[
                    isSupplier ? METHOD[p.method] : null,
                    p.orderNumber ? `order #${p.orderNumber}` : null,
                    formatDateTime(p.paymentDate, tz),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  trailing={
                    <span className="flex flex-col items-end gap-1">
                      <span className={`font-semibold tabular ${p.reversed ? 'text-muted line-through' : 'text-ok'}`}>{format(p.amount)}</span>
                      {p.reversed ? <Badge>Reversed</Badge> : null}
                    </span>
                  }
                />
              ))}
            </ListCard>
            <LoadMore hasMore={Boolean(payments.hasNextPage)} loading={payments.isFetchingNextPage} onLoad={() => void payments.fetchNextPage()} />
          </>
        )}
      </PageBody>
      <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Payment">
        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="text-[15px]">
              <p className="text-2xl font-semibold tabular">{format(selected.amount)}</p>
              <p className="text-muted">
                {selected.storeName} · {METHOD[selected.method]} · {formatDateTime(selected.paymentDate, tz)}
              </p>
              {selected.referenceNumber ? <p className="text-muted">Ref: {selected.referenceNumber}</p> : null}
              {selected.reversed ? <p className="mt-1 font-medium text-bad">This payment was reversed.</p> : null}
            </div>
            <Link
              to={`/stores/${selected.storeId}`}
              className="flex h-12 items-center justify-center rounded-xl border border-line-strong font-semibold text-ink"
            >
              Open client
            </Link>
            {!selected.reversed ? (
              <Button
                variant="dangerGhost"
                onClick={() => {
                  setReversing(selected);
                  setSelected(null);
                }}
              >
                Reverse payment
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      <ReversePaymentSheet payment={reversing} onClose={() => setReversing(null)} />
    </>
  );
}
