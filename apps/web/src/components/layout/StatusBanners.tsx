import { CircleAlert, RefreshCw, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useOnline } from '../../hooks/useOnline';
import { useToasts } from '../../stores/toast';
import { cn } from '../../utils/cn';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-ink px-4 pt-safe text-sm text-white">
      <span className="flex min-h-9 items-center gap-2">
        <WifiOff className="size-4" aria-hidden />
        You're offline. Showing saved information.
      </span>
    </div>
  );
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Offers a new app version instead of silently reloading mid-task. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      window.setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6">
      <div role="status" className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-lg">
        <RefreshCw className="size-5 shrink-0" aria-hidden />
        <p className="flex-1 text-sm">A new version is ready.</p>
        <button type="button" onClick={() => setNeedRefresh(false)} className="h-10 px-2 text-sm text-white/70">
          Later
        </button>
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="h-10 rounded-xl bg-white px-3 text-sm font-semibold text-ink"
        >
          Update
        </button>
      </div>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm font-medium shadow-lg',
            t.tone === 'error' ? 'bg-bad text-white' : 'bg-ink text-white',
          )}
        >
          {t.tone === 'error' ? <CircleAlert className="size-5 shrink-0" aria-hidden /> : null}
          {t.message}
        </button>
      ))}
    </div>
  );
}
