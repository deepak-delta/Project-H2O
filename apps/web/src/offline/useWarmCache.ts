import { useQueryClient } from '@tanstack/react-query';
import type { Role } from '@wd/shared';
import { useEffect } from 'react';
import { productsQueryOptions } from '../features/catalog/api';
import { RECENT_STORES, storesQueryOptions } from '../features/stores/api';
import { useOnline } from '../hooks/useOnline';
import { api } from '../services/api';
import { qk } from '../services/queryKeys';

/**
 * Fetches what's needed to record a delivery without a connection, so it is on the phone
 * before the signal drops: products and recent stores (supplier) or the home screen (store).
 */
export function useWarmCache(role: Role): void {
  const queryClient = useQueryClient();
  const online = useOnline();
  useEffect(() => {
    if (!online) return;
    void queryClient.prefetchQuery(productsQueryOptions(false));
    if (role === 'SUPPLIER') {
      void queryClient.prefetchInfiniteQuery(storesQueryOptions(RECENT_STORES));
    } else {
      void queryClient.prefetchQuery({ queryKey: qk.storeHome, queryFn: () => api.get('/store/home') });
    }
  }, [online, role, queryClient]);
}
