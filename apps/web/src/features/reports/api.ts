import { useQuery } from '@tanstack/react-query';
import type { InventoryReport, OutstandingReport, PaymentDto, SalesReport } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

export function useSalesReport(from: string, to: string, groupBy: 'day' | 'month') {
  return useQuery({
    queryKey: [...qk.reports, 'sales', from, to, groupBy],
    queryFn: () => api.get<SalesReport>(`/reports/sales?from=${from}&to=${to}&groupBy=${groupBy}`),
  });
}

export function useOutstandingReport() {
  return useQuery({ queryKey: [...qk.reports, 'outstanding'], queryFn: () => api.get<OutstandingReport>('/reports/outstanding') });
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
