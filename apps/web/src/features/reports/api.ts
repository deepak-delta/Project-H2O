import { useQuery } from '@tanstack/react-query';
import type { BusinessSummary, DuesBreakdown, InventoryReport, OutstandingReport, PaymentDto, SalesReport } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

export function useSalesReport(from: string, to: string, groupBy: 'day' | 'month') {
  return useQuery({
    queryKey: [...qk.reports, 'sales', from, to, groupBy],
    queryFn: () => api.get<SalesReport>(`/reports/sales?from=${from}&to=${to}&groupBy=${groupBy}`),
  });
}

export function useBusinessSummary(from: string, to: string) {
  return useQuery({
    queryKey: [...qk.reports, 'summary', from, to],
    queryFn: () => api.get<BusinessSummary>(`/reports/summary?from=${from}&to=${to}`),
  });
}

export function useOutstandingReport() {
  return useQuery({ queryKey: [...qk.reports, 'outstanding'], queryFn: () => api.get<OutstandingReport>('/reports/outstanding') });
}

/** One client's unpaid bills, for the reminder message. Always fresh: it's about to be sent. */
export function useDues(storeId: string | null) {
  return useQuery({
    queryKey: [...qk.reports, 'dues', storeId],
    queryFn: () => api.get<DuesBreakdown>(`/stores/${storeId}/dues`),
    enabled: Boolean(storeId),
    staleTime: 0,
  });
}

export function useInventoryReport(from: string, to: string) {
  return useQuery({
    queryKey: [...qk.reports, 'inventory', from, to],
    queryFn: () => api.get<InventoryReport>(`/reports/inventory?from=${from}&to=${to}`),
  });
}

export function usePaymentsReport(from: string, to: string) {
  return useQuery({
    queryKey: [...qk.reports, 'payments', from, to],
    queryFn: () => api.get<{ rows: PaymentDto[]; truncated: boolean }>(`/reports/payments?from=${from}&to=${to}`),
  });
}
