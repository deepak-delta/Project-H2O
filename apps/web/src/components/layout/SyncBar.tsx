import { CircleAlert, CloudUpload, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { useOnline } from '../../hooks/useOnline';
import { useOutbox } from '../../offline/engine';
import { cn } from '../../utils/cn';

/** Always-visible reminder that some entries are only on this phone so far. */
export function SyncBar() {
  const items = useOutbox((s) => s.items);
  const syncing = useOutbox((s) => s.syncing);
  const online = useOnline();
  if (items.length === 0) return null;

  const failed = items.filter((i) => i.status === 'FAILED').length;
  const waiting = items.length - failed;
  const text =
    failed > 0
      ? `${failed} entr${failed === 1 ? 'y' : 'ies'} couldn't sync. Tap to review.`
      : syncing && online
        ? `Syncing ${waiting} entr${waiting === 1 ? 'y' : 'ies'}…`
        : `${waiting} entr${waiting === 1 ? 'y' : 'ies'} saved on this phone, waiting to sync`;
  const Icon = failed > 0 ? CircleAlert : syncing && online ? RefreshCw : CloudUpload;

  return (
    <Link
      to="/sync"
      role="status"
      className={cn(
        'flex min-h-11 items-center gap-2 px-safe text-sm font-medium',
        failed > 0 ? 'bg-bad-bg text-bad' : 'bg-brand-50 text-brand-800',
      )}
    >
      <Icon className={cn('size-4 shrink-0', syncing && online && failed === 0 && 'animate-spin')} aria-hidden />
      <span className="flex-1">{text}</span>
    </Link>
  );
}
