import { zonedDateKey, type MovementDto, type MovementType, type StockSummary } from '@wd/shared';
import { Boxes, PackagePlus, RefreshCw, ScanLine, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { ListSkeleton, Skeleton } from '../../components/ui/Skeleton';
import { Stat } from '../../components/ui/Stat';
import { useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { formatTime } from '../../utils/format';
import { useHolders, useMovements, useStock } from './api';
import { StockActionSheet, type StockAction } from './StockActionSheet';

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  OPENING: 'Starting count',
  PURCHASE: 'Stock added',
  REFILL: 'Refilled',
  DELIVERY: 'Delivered',
  RETURN: 'Empties back',
  DAMAGE: 'Damaged',
  LOSS: 'Lost',
  ADJUSTMENT: 'Count corrected',
  REVERSAL: 'Reversed',
};

function describe(m: MovementDto): string {
  const parts: string[] = [];
  const fmt = (n: number, what: string) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${what}`;
  if (m.filledDelta) parts.push(fmt(m.filledDelta, 'filled'));
  if (m.emptyDelta) parts.push(fmt(m.emptyDelta, 'empty'));
  if (m.withCustomersDelta && m.type !== 'DELIVERY' && m.type !== 'RETURN') parts.push(fmt(m.withCustomersDelta, 'at clients'));
  if (m.damagedDelta) parts.push(fmt(m.damagedDelta, 'damaged'));
  return parts.join(', ');
}

export default function InventoryPage() {
  const stock = useStock();
  const holders = useHolders();
  const tz = useTimezone();
  const today = zonedDateKey(new Date(), tz);
  const movements = useMovements({ date: today });
  const [sheet, setSheet] = useState<{ action: StockAction; product: StockSummary } | null>(null);
  const moves = movements.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Inventory" back="/more" />
      <PageBody>
        {stock.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : stock.isError ? (
          <ErrorRetry message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />
        ) : stock.data.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-6" />}
            title="No products yet"
            description="Add a product like a 20L can to start tracking stock."
            action={
              <Link to="/products" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
                Add product
              </Link>
            }
          />
        ) : (
          stock.data.map((p) => (
            <Card key={p.productId} className="p-4">
              <p className="mb-3 font-semibold text-ink">{p.productName}</p>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Filled" value={p.filled} tone={p.filled < 0 ? 'bad' : 'default'} />
                <Stat label="Empty" value={p.empty} tone={p.empty < 0 ? 'bad' : 'default'} />
                {p.isReturnable ? <Stat label="With clients" value={p.withCustomers} to="/inventory/holders" /> : null}
                {p.isReturnable ? <Stat label="Damaged" value={p.damaged} /> : null}
              </div>
              {p.filled < 0 || p.empty < 0 ? (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-bad">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden />
                  Below zero. Do a count and use “Correct count”.
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <ActionChip icon={<PackagePlus className="size-4" />} label="Add stock" onClick={() => setSheet({ action: 'PURCHASE', product: p })} />
                {p.isReturnable ? (
                  <ActionChip icon={<RefreshCw className="size-4" />} label="Refill" onClick={() => setSheet({ action: 'REFILL', product: p })} />
                ) : null}
                <ActionChip icon={<TriangleAlert className="size-4" />} label="Damaged / lost" onClick={() => setSheet({ action: 'DAMAGE', product: p })} />
                <ActionChip icon={<ScanLine className="size-4" />} label="Correct count" onClick={() => setSheet({ action: 'COUNT', product: p })} />
              </div>
            </Card>
          ))
        )}

        <section>
          <SectionTitle action={<Link to="/inventory/holders" className="text-sm font-semibold text-brand-700">See all</Link>}>
            Cans with clients
          </SectionTitle>
          {holders.isPending ? (
            <ListSkeleton rows={3} />
          ) : holders.data && holders.data.length > 0 ? (
            <ListCard>
              {holders.data.slice(0, 5).map((h) => (
                <ListRow key={h.storeId} to={`/stores/${h.storeId}`} title={h.storeName} trailing={<span className="font-semibold tabular">{h.quantity}</span>} />
              ))}
            </ListCard>
          ) : (
            <Card className="px-4 py-3.5 text-sm text-muted">No cans are out with clients.</Card>
          )}
        </section>

        <section>
          <SectionTitle>Today's movements</SectionTitle>
          {movements.isPending ? (
            <ListSkeleton rows={3} />
          ) : moves.length === 0 ? (
            <Card className="px-4 py-3.5 text-sm text-muted">Nothing moved today yet.</Card>
          ) : (
            <>
              <ListCard>
                {moves.map((m) => (
                  <ListRow
                    key={m.id}
                    title={`${MOVEMENT_LABEL[m.type]}${m.orderNumber ? ` #${m.orderNumber}` : ''}`}
                    subtitle={[m.storeName, m.productName, formatTime(m.occurredAt, tz)].filter(Boolean).join(' · ')}
                    trailing={<span className="text-sm text-ink-2 tabular">{describe(m)}</span>}
                  />
                ))}
              </ListCard>
              <LoadMore
                hasMore={Boolean(movements.hasNextPage)}
                loading={movements.isFetchingNextPage}
                onLoad={() => void movements.fetchNextPage()}
              />
            </>
          )}
        </section>
      </PageBody>

      {sheet ? <StockActionSheet action={sheet.action} product={sheet.product} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function ActionChip({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface text-sm font-medium text-ink-2 hover:bg-canvas active:bg-line/50"
    >
      <span className="text-brand-700">{icon}</span>
      {label}
    </button>
  );
}
