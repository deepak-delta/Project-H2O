import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelOrderInput,
  DeliverOrderInput,
  OrderDto,
  OrderListItem,
  OrderStatus,
  Page,
  PaymentDto,
  PlaceOrderInput,
  QuickSaleInput,
  QuickSaleResult,
  WeekPlan,
} from '@wd/shared';
import { submitOrQueue, type SubmitResult } from '../../offline/engine';
import type { OutboxItem } from '../../offline/outbox';
import { api } from '../../services/api';
import { useSession } from '../auth/session';
import { MONEY_AND_STOCK_KEYS, qk } from '../../services/queryKeys';

export interface OrderListParams {
  status?: OrderStatus | 'OPEN';
  date?: string;
  /** Orders with a delivery on this day. */
  deliveredOn?: string;
  storeId?: string;
  search?: string;
  /** 'oldest': first added at the top. */
  sort?: 'newest' | 'oldest';
}

/** The owner's next 7 days of deliveries (and late ones). */
export function useWeekPlan(enabled = true) {
  return useQuery({ queryKey: [...qk.ordersRoot, 'week'], queryFn: () => api.get<WeekPlan>('/orders/week'), enabled });
}

export function useOrders(params: OrderListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.orders({ ...params }),
    enabled,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...params, cursor: pageParam })) if (v) search.set(k, v);
      return api.get<Page<OrderListItem>>(`/orders?${search.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: qk.order(id), queryFn: () => api.get<OrderDto>(`/orders/${id}`) });
}

type Summary = OutboxItem['summary'];

/** Works offline: returns `{ queued: true }` when the sale was saved on the phone to sync later. */
export function useQuickSale() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  return useMutation({
    mutationFn: ({ input, summary }: { input: QuickSaleInput; summary: Summary }) =>
      submitOrQueue<QuickSaleResult>({ userId: user.id, kind: 'quickSale', path: '/orders/quick-sale', body: input, summary }),
    onSuccess: (result: SubmitResult<QuickSaleResult>) => {
      if (result.queued) return;
      queryClient.setQueryData(qk.order(result.data.order.id), result.data.order);
      for (const key of MONEY_AND_STOCK_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of MONEY_AND_STOCK_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: qk.storeHome });
  };
}

export function usePlaceOrder() {
  const invalidate = useInvalidateAll();
  const { user } = useSession();
  return useMutation({
    mutationFn: ({ input, summary }: { input: PlaceOrderInput; summary: Summary }) =>
      submitOrQueue<OrderDto>({ userId: user.id, kind: 'placeOrder', path: '/orders', body: input, summary }),
    onSuccess: (r: SubmitResult<OrderDto>) => {
      if (!r.queued) invalidate();
    },
  });
}

export function useDeliverOrder(orderId: string) {
  const invalidate = useInvalidateAll();
  const { user } = useSession();
  return useMutation({
    mutationFn: ({ input, summary }: { input: DeliverOrderInput; summary: Summary }) =>
      submitOrQueue<QuickSaleResult>({ userId: user.id, kind: 'deliverOrder', path: `/orders/${orderId}/deliver`, body: input, summary }),
    onSuccess: (r: SubmitResult<QuickSaleResult>) => {
      if (!r.queued) invalidate();
    },
  });
}

export function useOrderStatus(orderId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (status: 'CONFIRMED' | 'OUT_FOR_DELIVERY') => api.post<OrderDto>(`/orders/${orderId}/status`, { status }),
    onSuccess: (order) => {
      queryClient.setQueryData(qk.order(orderId), order);
      invalidate();
    },
  });
}

export function useCancelOrder(orderId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CancelOrderInput) => api.post<OrderDto>(`/orders/${orderId}/cancel`, input),
    onSuccess: (order) => {
      queryClient.setQueryData(qk.order(orderId), order);
      invalidate();
    },
  });
}

export function useReversePayment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      api.post<{ payment: PaymentDto; storeBalance: string }>(`/payments/${paymentId}/reverse`, { reason }),
    onSuccess: invalidate,
  });
}
