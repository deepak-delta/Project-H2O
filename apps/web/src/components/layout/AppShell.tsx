import { RefreshCw } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useSession } from '../../features/auth/session';
import { syncPush } from '../../features/notifications/push';
import { PageSpinner, Spinner } from '../ui/Spinner';
import { useSyncEngine } from '../../offline/engine';
import { useLiveUpdates } from '../../offline/useLiveUpdates';
import { useWarmCache } from '../../offline/useWarmCache';
import { BottomNav } from './BottomNav';
import { PULL_TRIGGER, usePullToRefresh } from './usePullToRefresh';
import { SyncBar } from './SyncBar';

/**
 * Signed-in layout: page content above a role-specific bottom nav. Focused flows (new order)
 * use `nav={false}` so their own sticky action bar owns the bottom of the screen.
 */
// Loaded after the first screen: only needed once per device, and pulls in WebAuthn code.
const BiometricEnrollPrompt = lazy(() =>
  import('../../features/auth/BiometricEnrollPrompt').then((m) => ({ default: m.BiometricEnrollPrompt })),
);

export function AppShell({ nav = true }: { nav?: boolean }) {
  const { user } = useSession();
  useSyncEngine(user.id);
  useWarmCache(user.role);
  // Everyone sees what others record within seconds, and fresh data on return to the app.
  useLiveUpdates(user.role);
  // Keep this phone registered for notifications (on open, and on return after an hour away).
  useEffect(() => {
    let last = Date.now();
    void syncPush();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 60 * 60 * 1000) {
        last = Date.now();
        void syncPush();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user.id]);
  const scroller = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh(scroller);
  const { pathname } = useLocation();
  // Each screen starts at the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [pathname]);
  return (
    // The app scrolls inside this box, never the page itself. A scrolling page makes Chrome and
    // Safari slide their own toolbars in and out (and iOS shifts the page after the keyboard
    // closes), which drags the bottom bar with them. With the page still, the bar stays put.
    <div ref={scroller} data-scroll-root className={nav ? 'h-dvh overflow-y-auto overscroll-none lg:pl-60' : 'h-dvh overflow-y-auto overscroll-none'}>
      {/* Bottom padding = nav height + safe area, so the last row is never hidden. */}
      <main
        className={
          nav ? 'mx-auto max-w-xl pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:max-w-3xl lg:pb-8' : 'mx-auto max-w-xl'
        }
      >
        <PullIndicator pull={pull} refreshing={refreshing} />
        <SyncBar />
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      {nav ? <BottomNav role={user.role} /> : null}
      {nav ? (
        <Suspense fallback={null}>
          <BiometricEnrollPrompt />
        </Suspense>
      ) : null}
    </div>
  );
}

/** The round badge that follows a pull-down and spins while the screen refreshes. */
function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (!refreshing && pull === 0) return null;
  const ready = pull >= PULL_TRIGGER;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center lg:pl-60"
      style={{ top: `calc(env(safe-area-inset-top) + ${refreshing ? 56 : Math.max(pull - 8, 0)}px)` }}
    >
      <span
        role={refreshing ? 'status' : undefined}
        className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-brand-700 shadow-sm"
      >
        {refreshing ? (
          <Spinner label="Refreshing" />
        ) : (
          <RefreshCw
            className="size-5"
            aria-hidden
            style={{ transform: `rotate(${(pull / PULL_TRIGGER) * 270}deg)`, opacity: ready ? 1 : 0.6 }}
          />
        )}
      </span>
    </div>
  );
}
