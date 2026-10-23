import { CheckSquare, Square, UserRound, UsersRound } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ListCard, ListRow } from '../../components/ui/Card';
import { Sheet } from '../../components/ui/Sheet';
import { Spinner } from '../../components/ui/Spinner';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useBulkAssign, useStaffList } from '../staff/api';

/** The tick box drawn at the start of a row while choosing orders. */
export function SelectMark({ checked }: { checked: boolean }) {
  return (
    <>
      {checked ? <CheckSquare className="size-6 text-brand-700" aria-hidden /> : <Square className="size-6 text-muted" aria-hidden />}
      <span className="sr-only">{checked ? 'Selected: ' : 'Not selected: '}</span>
    </>
  );
}

/** Bar above the bottom nav while choosing: select all, and hand the chosen orders over. */
export function SelectionBar({
  count,
  allSelected,
  onToggleAll,
  onAssign,
}: {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onAssign: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3 shadow-[0_-4px_12px_rgb(16_24_40/0.06)] lg:bottom-0 lg:left-60">
      <div className="mx-auto flex max-w-xl items-center gap-3 lg:max-w-3xl">
        <Button variant="secondary" onClick={onToggleAll} className="shrink-0">
          {allSelected ? 'Clear all' : 'Select all'}
        </Button>
        <Button block disabled={count === 0} onClick={onAssign} icon={<UsersRound className="size-5" aria-hidden />}>
          {count === 0 ? 'Choose orders' : `Give ${count} to staff`}
        </Button>
      </div>
    </div>
  );
}

/** Pick who delivers the chosen orders. */
export function AssignSheet({ orderIds, open, onClose, onDone }: { orderIds: string[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const staff = useStaffList(open);
  const assign = useBulkAssign();
  const active = staff.data?.filter((s) => s.active) ?? [];
  const n = orderIds.length;

  const give = (staffId: string | null, name: string) =>
    assign.mutate(
      { orderIds, staffId },
      {
        onSuccess: (r) => {
          const what = `${r.assigned} order${r.assigned === 1 ? '' : 's'}`;
          const skipped = r.skipped ? ` ${r.skipped} already delivered or cancelled, left as they were.` : '';
          toast.success(staffId ? `${what} given to ${name}. They've been told.${skipped}` : `${what} back with you.${skipped}`);
          onDone();
        },
        onError: (err) => toast.error(errorMessage(err, 'The orders were not given out. Please try again.')),
      },
    );

  return (
    <Sheet open={open} onClose={onClose} title={`Give ${n} order${n === 1 ? '' : 's'} to`}>
      {staff.isPending || assign.isPending ? (
        <div className="flex justify-center py-8 text-brand-700">
          <Spinner label={assign.isPending ? 'Saving' : 'Loading'} />
        </div>
      ) : (
        <ListCard>
          {active.map((s) => (
            <ListRow key={s.id} title={s.name} leading={<UserRound className="size-5 text-muted" aria-hidden />} onClick={() => give(s.id, s.name)} chevron />
          ))}
          <ListRow title="Me (owner)" subtitle="Take them back from staff" leading={<UserRound className="size-5 text-muted" aria-hidden />} onClick={() => give(null, 'you')} chevron />
        </ListCard>
      )}
      {staff.data && active.length === 0 ? <p className="mt-3 text-sm text-muted">No staff yet. Add them under More → Staff.</p> : null}
    </Sheet>
  );
}
