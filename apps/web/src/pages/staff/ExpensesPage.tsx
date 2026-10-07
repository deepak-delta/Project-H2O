import { Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { AddEntrySheet } from '../../features/cashflow/AddEntrySheet';
import { CATEGORY_LABEL, METHOD_LABEL } from '../../features/cashflow/labels';
import { useMyDay } from '../../features/staff/api';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { formatTime } from '../../utils/format';

/** Delivery staff: what they spent today (fuel etc.). Starts empty every day. */
export default function StaffExpensesPage() {
  const day = useMyDay();
  const format = useMoney();
  const tz = useTimezone();
  const [adding, setAdding] = useState(false);
  const expenses = day.data?.activity.filter((a) => a.kind === 'EXPENSE') ?? [];

  return (
    <>
      <PageHeader
        title="Expenses today"
        action={
          <Button variant="ghost" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      <PageBody>
        {day.isPending ? (
          <ListSkeleton rows={3} />
        ) : day.isError ? (
          <ErrorRetry message={errorMessage(day.error)} onRetry={() => void day.refetch()} />
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No expenses today"
            description="Record fuel or anything else you pay for on the route."
            action={<Button onClick={() => setAdding(true)}>Add expense</Button>}
          />
        ) : (
          <>
            <Card className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] text-ink-2">Spent today</span>
              <span className="text-lg font-semibold text-ink tabular">{format(day.data.expenses)}</span>
            </Card>
            <ListCard>
              {expenses.map((e) =>
                e.kind === 'EXPENSE' ? (
                  <ListRow
                    key={e.id}
                    title={CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? 'Expense'}
                    subtitle={[formatTime(e.at, tz), e.description, METHOD_LABEL[e.method]].filter(Boolean).join(' · ')}
                    trailing={<span className="font-semibold text-ink tabular">{format(e.amount)}</span>}
                  />
                ) : null,
              )}
            </ListCard>
          </>
        )}
      </PageBody>
      <AddEntrySheet open={adding} onClose={() => setAdding(false)} expenseOnly />
    </>
  );
}
