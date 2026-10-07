import { infiniteQueryOptions, keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CanMovementDto,
  CanCountInput,
  CanReturnInput,
  CreateStoreInput,
  LedgerEntryDto,
  Page,
  PaymentDto,
  RecordPaymentInput,
  StoreDetail,
  StoreInput,
  StoreListItem,
  StoreLoginInput,
  StorePriceDto,
  StorePricesInput,
  StoreStatus,
} from '@wd/shared';
import { submitOrQueue, type SubmitResult } from '../../offline/engine';
import type { OutboxItem } from '../../offline/outbox';
import { api } from '../../services/api';
import { useSession } from '../auth/session';
import { MONEY_AND_STOCK_KEYS, qk } from '../../services/queryKeys';

export type StoreFilter = 'all' | 'owes' | 'cans' | 'inactive';

export interface StoreListParams {
  search?: string;
  filter?: StoreFilter;
  sort?: 'name' | 'recent' | 'balance';
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function storesQueryOptions(params: StoreListParams) {
  return infiniteQueryOptions({
    queryKey: qk.stores({ ...params }),
    queryFn: ({ pageParam }) =>
      api.get<{ items: StoreListItem[]; nextOffset: number | null }>(
        `/stores${toQuery({ ...params, offset: pageParam, limit: 50 })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
}

/** The list the new-order picker shows first; also warmed at start-up for offline use. */
export const RECENT_STORES: StoreListParams = { search: '', sort: 'recent' };

export function useStores(params: StoreListParams) {
  return useInfiniteQuery({ ...storesQueryOptions(params), placeholderData: keepPreviousData });
}

/** Every store seen in any cached list (for offline search), most recently fetched first. */
export function cachedStores(queryClient: QueryClient): StoreListItem[] {
  const byId = new Map<string, StoreListItem>();
  for (const [key, data] of queryClient.getQueriesData<{ pages: { items: StoreListItem[] }[] }>({ queryKey: qk.storesRoot })) {
    if (key[1] !== 'list' || !data?.pages) continue;
    for (const page of data.pages) for (const s of page.items) if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return [...byId.values()];
}

/** Offline stand-in for a store's detail when only its list row was saved. */
export function storeDetailFromListItem(s: StoreListItem): StoreDetail {
  return { ...s, address: null, notes: null, creditLimit: null, cans: [], lastOrderItems: [], hasLogin: false, loginPhone: null, createdAt: '' };
}

export function useStore(id: string | undefined) {
  return useQuery({
    queryKey: qk.store(id ?? ''),
    queryFn: () => api.get<StoreDetail>(`/stores/${id}`),
    enabled: Boolean(id),
  });
}

/** Prices to start a new store with: the ones most recently agreed with any store. */
export function usePriceSuggestions() {
  return useQuery({
    queryKey: [...qk.storesRoot, 'price-suggestions'],
    queryFn: () => api.get<StorePriceDto[]>('/stores/price-suggestions'),
  });
}

export function useSetStorePrices(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StorePricesInput) => api.put<StoreDetail>(`/stores/${id}/prices`, input),
    onSuccess: (store) => {
      queryClient.setQueryData(qk.store(id), store);
      void queryClient.invalidateQueries({ queryKey: qk.storesRoot });
    },
  });
}

export function useStoreLedger(id: string) {
  return useInfiniteQuery({
    queryKey: qk.storeLedger(id),
    queryFn: ({ pageParam }) => api.get<Page<LedgerEntryDto>>(`/stores/${id}/ledger${toQuery({ cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useStoreCans(id: string) {
  return useInfiniteQuery({
    queryKey: qk.storeCans(id),
    queryFn: ({ pageParam }) => api.get<Page<CanMovementDto>>(`/stores/${id}/cans${toQuery({ cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function useInvalidateMoneyAndStock() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of MONEY_AND_STOCK_KEYS) void queryClient.invalidateQueries({ queryKey: key });
  };
}

export function useCreateStore() {
  const invalidate = useInvalidateMoneyAndStock();
  return useMutation({
    mutationFn: (input: CreateStoreInput) => api.post<StoreDetail>('/stores', input),
    onSuccess: invalidate,
  });
}

export function useUpdateStore(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreInput) => api.patch<StoreDetail>(`/stores/${id}`, input),
    onSuccess: (store) => {
      queryClient.setQueryData(qk.store(id), store);
      void queryClient.invalidateQueries({ queryKey: qk.storesRoot });
    },
  });
}

export function useSetStoreStatus(id: string) {
  const invalidate = useInvalidateMoneyAndStock();
  return useMutation({
    mutationFn: (status: StoreStatus) => api.post<StoreDetail>(`/stores/${id}/status`, { status }),
    onSuccess: invalidate,
  });
}

type Summary = OutboxItem['summary'];
export type PaymentResult = { payment: PaymentDto; storeBalance: string; replayed: boolean };

/** Works offline (queued on the phone, synced later). */
export function useRecordPayment() {
  const invalidate = useInvalidateMoneyAndStock();
  const { user } = useSession();
  return useMutation({
    mutationFn: ({ input, summary }: { input: RecordPaymentInput; summary: Summary }) =>
      submitOrQueue<PaymentResult>({ userId: user.id, kind: 'payment', path: '/payments', body: input, summary }),
    onSuccess: (r: SubmitResult<PaymentResult>) => {
      if (!r.queued) invalidate();
    },
  });
}

/** Works offline (queued on the phone, synced later). */
export function useCanReturn(storeId: string) {
  const invalidate = useInvalidateMoneyAndStock();
  const { user } = useSession();
  return useMutation({
    mutationFn: ({ input, summary }: { input: CanReturnInput; summary: Summary }) =>
      submitOrQueue<StoreDetail>({ userId: user.id, kind: 'canReturn', path: `/stores/${storeId}/can-returns`, body: input, summary }),
    onSuccess: (r: SubmitResult<StoreDetail>) => {
      if (!r.queued) invalidate();
    },
  });
}

/** Owner: set the real number of cans at a client (recorded as a correction). */
export function useSetClientCans(storeId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMoneyAndStock();
  return useMutation({
    mutationFn: (input: CanCountInput) => api.put<StoreDetail>(`/stores/${storeId}/cans`, input),
    onSuccess: (store) => {
      queryClient.setQueryData(qk.store(storeId), store);
      invalidate();
    },
  });
}

export function useSetStoreLogin(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreLoginInput) => api.put<StoreDetail>(`/stores/${id}/login`, input),
    onSuccess: (store) => queryClient.setQueryData(qk.store(id), store),
  });
}

export function useDisableStoreLogin(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<StoreDetail>(`/stores/${id}/login`),
    onSuccess: (store) => queryClient.setQueryData(qk.store(id), store),
  });
}

/** Push a payment reminder to the store's phone; `sent` is 0 when it has no notifications on. */
export function useSendReminder(storeId: string) {
  return useMutation({ mutationFn: () => api.post<{ sent: number }>(`/stores/${storeId}/remind`) });
}
