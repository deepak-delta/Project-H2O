import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../services/api';
import { MONEY_AND_STOCK_KEYS } from '../services/queryKeys';

/** How often the owner's app asks "anything new?" while it is on screen. */
const CHECK_EVERY_MS = 10 * 1000;

/**
 * Keeps the owner's screens current when someone else (staff, a store) records something.
 * A tiny request reports when the business last changed; only when that moves do the money and
 * stock screens refetch. Pauses while the app is in the background or offline (React Query does
 * not poll hidden or offline pages) and checks again as soon as the app is opened.
 */
export function useLiveUpdates(enabled: boolean): void {
  const queryClient = useQueryClient();
  const changes = useQuery({
    queryKey: ['changes'],
    queryFn: () => api.get<{ at: string | null }>('/changes'),
    enabled,
    staleTime: 0,
    refetchInterval: CHECK_EVERY_MS,
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
}
