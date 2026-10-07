import { lazy, Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useSession } from '../../features/auth/session';
import { PageSpinner } from '../ui/Spinner';
import { useSyncEngine } from '../../offline/engine';
import { useLiveUpdates } from '../../offline/useLiveUpdates';
import { useWarmCache } from '../../offline/useWarmCache';
import { BottomNav } from './BottomNav';
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
  // The owner sees staff and store activity within seconds.
  useLiveUpdates(user.role === 'SUPPLIER');
  const scroller = useRef<HTMLDivElement>(null);
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
