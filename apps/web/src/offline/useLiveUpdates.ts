import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@wd/shared';
import { useEffect, useRef } from 'react';
import { api } from '../services/api';
import { MONEY_AND_STOCK_KEYS } from '../services/queryKeys';

/** How often the app asks "anything new?" while it is on screen. */
const CHECK_EVERY_MS: Record<Role, number> = { SUPPLIER: 10_000, STAFF: 15_000, STORE: 30_000 };

/** Away at least this long, everything on screen is refetched on return, not only after a change. */
const AWAY_REFRESH_MS = 5_000;

/** Fired by the Android app when it comes back to the front (see native/bootstrap). */
export const APP_RESUME_EVENT = 'wd:resume';

/**
 * Keeps every screen current when someone else records something: staff and clients for the
 * owner, the owner for staff, deliveries and payments for a client. A tiny request reports when
 * the data last changed; only when that moves do the money and stock screens refetch. Polling
 * pauses while the app is in the background or offline; on return (or when the network comes
 * back) the screen on show is refetched at once.
 */
export function useLiveUpdates(role: Role): void {
  const queryClient = useQueryClient();
  const changes = useQuery({
    queryKey: ['changes'],
    queryFn: () => api.get<{ at: string | null }>('/changes'),
    staleTime: 0,
    refetchInterval: CHECK_EVERY_MS[role],
  });
  const seen = useRef<string | null | undefined>(undefined);
  const at = changes.data?.at;

  useEffect(() => {
    if (at === undefined) return;
    if (seen.current !== undefined && at !== seen.current) {
      for (const key of MONEY_AND_STOCK_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    }
    seen.current = at;
  }, [at, queryClient]);

  useEffect(() => {
    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
    let refreshedAt = 0;
    const refresh = () => {
      hiddenAt = null;
      // Resume and "visible" can both arrive for one return; refresh once.
      if (Date.now() - refreshedAt < 2_000) return;
      refreshedAt = Date.now();
      // Active queries refetch now; the rest when next shown.
      void queryClient.invalidateQueries();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt !== null && Date.now() - hiddenAt >= AWAY_REFRESH_MS) refresh();
    };
    // Some Android WebViews don't report going to the background, so the app tells us itself.
    window.addEventListener(APP_RESUME_EVENT, refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener(APP_RESUME_EVENT, refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [queryClient]);
}
