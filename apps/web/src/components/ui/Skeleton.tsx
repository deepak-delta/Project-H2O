import { useOfflineStall } from '../../hooks/useOfflineStall';
import { NotSavedOffline } from './NotSavedOffline';
import { cn } from '../../utils/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-line/70', className)} />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  if (useOfflineStall()) return <NotSavedOffline />;
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-busy>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}
