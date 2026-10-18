import { describeSchedule } from '@wd/shared';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { useSchedule } from './api';
import { nextDatesText } from './ScheduleEditor';

/** On a client's page: their regular delivery at a glance, or the way to set one up. */
export function RegularDeliveryCard({ storeId, active }: { storeId: string; active: boolean }) {
  const schedule = useSchedule(storeId);
  if (schedule.isPending) return <div className="h-16 animate-pulse rounded-[var(--radius-card)] border border-line bg-surface" aria-busy />;
  const s = schedule.data;
  if (!s && !active) return null;
  return (
    <Link
      to={`/stores/${storeId}/schedule`}
      className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"
    >
      <CalendarClock className="size-5 shrink-0 text-brand-700" aria-hidden />
      {s ? (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium text-ink">Regular delivery</span>
            {s.active ? null : <Badge tone="warn">Paused</Badge>}
          </span>
          <span className="block text-sm text-ink-2">
            {describeSchedule(s)} · {s.items.map((i) => `${i.quantity} × ${i.productName}`).join(', ')}
            {s.assignedTo ? ` · ${s.assignedTo.name}` : ''}
          </span>
          {s.active ? <span className="block text-sm text-muted">{nextDatesText(s.nextDates)}</span> : null}
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">Set up regular delivery</span>
          <span className="block text-sm text-muted">Every day, some weekdays, every few days or monthly</span>
        </span>
      )}
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
