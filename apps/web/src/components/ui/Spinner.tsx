import { useOfflineStall } from '../../hooks/useOfflineStall';
import { NotSavedOffline } from './NotSavedOffline';
import { cn } from '../../utils/cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center">
      <svg className={cn('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export function PageSpinner() {
  if (useOfflineStall()) return <NotSavedOffline />;
  return (
    <div className="flex min-h-[50dvh] items-center justify-center text-brand-700">
      <Spinner className="size-7" label="Loading" />
    </div>
  );
}
