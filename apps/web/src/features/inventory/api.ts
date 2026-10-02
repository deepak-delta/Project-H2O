import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CanHolder, DashboardSummary, MovementDto, Page, StockMovementInput, StockSummary } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

export function useStock() {
  return useQuery({ queryKey: qk.inventory, queryFn: () => api.get<StockSummary[]>('/inventory') });
}

export function useMovements(params: { date?: string; productId?: string }) {
  return useInfiniteQuery({
    queryKey: qk.movements({ ...params }),
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...params, cursor: pageParam })) if (v) search.set(k, v);
      return api.get<Page<MovementDto>>(`/inventory/movements?${search.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useHolders(productId?: string) {
  return useQuery({
    queryKey: qk.holders(productId),
    queryFn: () => api.get<CanHolder[]>(`/inventory/holders${productId ? `?productId=${productId}` : ''}`),
  });
}

export function useStockMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StockMovementInput) => api.post<MovementDto>('/inventory/movements', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.inventory });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<DashboardSummary>('/dashboard'),
    refetchInterval: 60 * 1000,
  });
}
