import type { CashEntryDto } from '@wd/shared';
import { Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field } from '../../components/ui/Field';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { PeriodChips, usePeriod } from '../../components/ui/PeriodPicker';
import { Sheet } from '../../components/ui/Sheet';
import { ListSkeleton, Skeleton } from '../../components/ui/Skeleton';
import { Stat } from '../../components/ui/Stat';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { formatDateTime } from '../../utils/format';
import { AddEntrySheet } from './AddEntrySheet';
import { useCashEntries, useCashSummary, useReverseCashEntry } from './api';
import { CATEGORY_LABEL, METHOD_LABEL } from './labels';

export default function CashFlowPage() {
  const { period, setPreset, allowed } = usePeriod('today');
  const summary = useCashSummary(period.from, period.to);
  const entries = useCashEntries(period.from, period.to);
  const format = useMoney();
  const tz = useTimezone();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<CashEntryDto | null>(null);
  const rows = entries.data?.pages.flatMap((p) => p.items) ?? [];
  const cash = summary.data?.byMethod.find((m) => m.method === 'CASH');

  return (
    <>
      <PageHeader
        title="Cash flow"
        back="/more"
        action={
          <Button variant="ghost" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      <PageBody>
        <PeriodChips value={period.preset} onChange={setPreset} allowed={allowed} />

        {summary.isPending ? (
          <Skeleton className="h-36 w-full" />
        ) : summary.isError ? (
          <ErrorRetry message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} />
        ) : (
          <Card className="grid grid-cols-2 gap-2 p-2">
            <Stat label="Money in" value={format(summary.data.moneyIn)} />
            <Stat label="Money out" value={format(summary.data.moneyOut)} />
            <Stat
              label="Net"
              value={format(summary.data.net)}
              tone={summary.data.net.startsWith('-') ? 'bad' : 'default'}
            />
            <Stat label="Cash in hand" value={format(cash?.net ?? '0')} hint="Cash in − cash out" />
          </Card>
        )}

        {summary.data && summary.data.byCategory.length > 0 ? (
          <section>
            <SectionTitle>By category</SectionTitle>
            <ListCard>
              {summary.data.byCategory.map((c) => (
                <ListRow
                  key={`${c.type}-${c.category}`}
                  title={CATEGORY_LABEL[c.category]}
                  subtitle={c.type === 'INCOME' ? 'Money in' : 'Money out'}
                  trailing={
                    <span className={`font-semibold tabular ${c.type === 'INCOME' ? 'text-ok' : 'text-ink'}`}>
                      {c.type === 'INCOME' ? '+' : '−'}
                      {format(c.amount)}
                    </span>
                  }
                />
              ))}
            </ListCard>
          </section>
        ) : null}

        <section>
          <SectionTitle>Entries</SectionTitle>
          {entries.isPending ? (
            <ListSkeleton rows={4} />
          ) : entries.isError ? (
            <ErrorRetry message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Receipt className="size-6" />}
              title={`Nothing recorded ${period.preset === 'today' ? 'today' : 'in this period'}`}
              description="Payments you collect appear here automatically. Add fuel, salary and other expenses."
              action={<Button onClick={() => setAdding(true)}>Add expense</Button>}
            />
          ) : (
            <>
              <ListCard>
                {rows.map((e) => (
                  <ListRow
                    key={e.id}
                    onClick={() => setSelected(e)}
                    title={e.storeName ? `${CATEGORY_LABEL[e.category]} · ${e.storeName}` : CATEGORY_LABEL[e.category]}
                    subtitle={[METHOD_LABEL[e.method], e.description, formatDateTime(e.date, tz)].filter(Boolean).join(' · ')}
                    trailing={
                      <span className="flex flex-col items-end gap-1">
                        <span className={`font-semibold tabular ${e.reversed ? 'text-muted line-through' : e.type === 'INCOME' ? 'text-ok' : 'text-ink'}`}>
                          {e.type === 'INCOME' ? '+' : '−'}
                          {format(e.amount.replace('-', ''))}
                        </span>
                        {e.reversed ? <Badge>Reversed</Badge> : e.isReversal ? <Badge>Reversal</Badge> : null}
                      </span>
                    }
                  />
                ))}
              </ListCard>
              <LoadMore hasMore={Boolean(entries.hasNextPage)} loading={entries.isFetchingNextPage} onLoad={() => void entries.fetchNextPage()} />
            </>
          )}
        </section>
      </PageBody>

      <AddEntrySheet open={adding} onClose={() => setAdding(false)} />
      <EntrySheet entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function EntrySheet({ entry, onClose }: { entry: CashEntryDto | null; onClose: () => void }) {
  const format = useMoney();
  const tz = useTimezone();
  const reverse = useReverseCashEntry();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canReverse = entry && !entry.fromPayment && !entry.reversed && !entry.isReversal;

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <Sheet open={entry !== null} onClose={close} title={entry ? CATEGORY_LABEL[entry.category] : ''}>
      {entry ? (
        <div className="flex flex-col gap-4">
          <div className="text-[15px]">
            <p className="text-2xl font-semibold tabular">{format(entry.amount)}</p>
            <p className="text-muted">
              {METHOD_LABEL[entry.method]} · {formatDateTime(entry.date, tz)}
            </p>
            {entry.description ? <p className="mt-1 text-ink-2">{entry.description}</p> : null}
            {entry.fromPayment ? <p className="mt-1 text-muted">Recorded from a payment. To undo it, reverse the payment.</p> : null}
          </div>
          {canReverse ? (
            <>
              <Field label="Reason to reverse" value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
              <Button
                variant="danger"
                size="lg"
                loading={reverse.isPending}
                onClick={() => {
                  if (reason.trim().length < 3) return setError('Say why this entry is being reversed.');
                  reverse.mutate(
                    { id: entry.id, reason: reason.trim() },
                    {
                      onSuccess: () => {
                        toast.success('Entry reversed.');
                        close();
                      },
                      onError: (err) => setError(errorMessage(err)),
                    },
                  );
                }}
              >
                Reverse entry
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
