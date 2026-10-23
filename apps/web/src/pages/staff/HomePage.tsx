import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { Skeleton } from '../../components/ui/Skeleton';
import { useSession } from '../../features/auth/session';
import { AddEntrySheet } from '../../features/cashflow/AddEntrySheet';
import { NotificationNudge } from '../../features/notifications/NotificationNudge';
import { useMyDay } from '../../features/staff/api';
import { StaffDay } from '../../features/staff/StaffDay';
import { errorMessage } from '../../services/api';

/** Delivery staff home: only today, only their own work. Empty again tomorrow. */
export default function StaffHomePage() {
  const { business, user } = useSession();
  const day = useMyDay();
  const [addingExpense, setAddingExpense] = useState(false);
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: business.timezone }).format(
    new Date(),
  );

  return (
    <>
      <PageHeader
        title={`Hi ${user.name.split(' ')[0]}`}
        subtitle={`${today} · ${business.businessName}`}
        action={
          <Button variant="ghost" icon={<Plus className="size-5" />} onClick={() => setAddingExpense(true)}>
            Expense
          </Button>
        }
      />
      <PageBody>
        <NotificationNudge />
        {day.isPending ? (
          <div className="space-y-4" aria-busy>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : day.isError ? (
          <ErrorRetry message={errorMessage(day.error)} onRetry={() => void day.refetch()} />
        ) : (
          <StaffDay day={day.data} self />
        )}
      </PageBody>
      <AddEntrySheet open={addingExpense} onClose={() => setAddingExpense(false)} expenseOnly />
    </>
  );
}
