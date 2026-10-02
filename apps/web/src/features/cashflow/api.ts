import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CashEntryDto, CashEntryInput, CashFlowSummary, Page } from '@wd/shared';
import { submitOrQueue, type SubmitResult } from '../../offline/engine';
import { api } from '../../services/api';
import { useSession } from '../auth/session';
import { qk } from '../../services/queryKeys';

export function useCashSummary(from: string, to: string) {
  return useQuery({
    queryKey: [...qk.cashflow, 'summary', from, to],
    queryFn: () => api.get<CashFlowSummary>(`/cashflow/summary?from=${from}&to=${to}`),
  });
}

export function useCashEntries(from: string, to: string) {
  return useInfiniteQuery({
    queryKey: [...qk.cashflow, 'list', from, to],
    queryFn: ({ pageParam }) =>
      api.get<Page<CashEntryDto>>(`/cashflow?from=${from}&to=${to}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function useInvalidateCash() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.cashflow });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  };
}

/** Works offline (queued on the phone, synced later). */
export function useAddCashEntry() {
  const invalidate = useInvalidateCash();
  const { user } = useSession();
  return useMutation({
    mutationFn: ({ input, title }: { input: CashEntryInput; title: string }) =>
      submitOrQueue<CashEntryDto>({
        userId: user.id,
        kind: 'cashEntry',
        path: '/cashflow',
        body: input,
        summary: { title, detail: input.type === 'EXPENSE' ? 'Expense' : 'Income', storeId: null },
      }),
    onSuccess: (r: SubmitResult<CashEntryDto>) => {
      if (!r.queued) invalidate();
    },
  });
}

export function useReverseCashEntry() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<CashEntryDto>(`/cashflow/${id}/reverse`, { reason }),
    onSuccess: invalidate,
  });
}
