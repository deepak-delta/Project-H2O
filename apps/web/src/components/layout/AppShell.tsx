import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router';

import { useSession } from '../../features/auth/session';
import { PageSpinner } from '../ui/Spinner';
import { useSyncEngine } from '../../offline/engine';
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
  return (
    <div className={nav ? 'min-h-dvh lg:pl-60' : 'min-h-dvh'}>
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
