import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateStaffInput, OrderDto, StaffDto, StaffTodayDto, UpdateStaffInput } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

/** A member of staff's own day (starts empty every morning). */
export function useMyDay() {
  return useQuery({ queryKey: qk.staffToday('me'), queryFn: () => api.get<StaffTodayDto>('/staff/today') });
}

/** Owner: one member of staff's day. */
export function useStaffDay(id: string) {
  return useQuery({ queryKey: qk.staffToday(id), queryFn: () => api.get<StaffTodayDto>(`/staff/${id}/today`) });
}

export function useStaffList(enabled = true) {
  return useQuery({ queryKey: [...qk.staffRoot, 'list'], queryFn: () => api.get<StaffDto[]>('/staff'), enabled });
}

export function useAddStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => api.post<StaffDto>('/staff', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.staffRoot }),
  });
}

export function useUpdateStaff(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStaffInput) => api.patch<StaffDto>(`/staff/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.staffRoot });
      // Turning someone off hands their orders back.
      void queryClient.invalidateQueries({ queryKey: qk.ordersRoot });
    },
  });
}

/** Delete a member of staff: their past work stays, they can't log in, their orders come back. */
export function useDeleteStaff(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/staff/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.staffRoot });
      void queryClient.invalidateQueries({ queryKey: qk.ordersRoot });
    },
  });
}

export function useResetStaffPin(id: string) {
  return useMutation({ mutationFn: (pin: string) => api.put<StaffDto>(`/staff/${id}/pin`, { pin }) });
}

/** Owner gives an order to a member of staff (null = take it back). */
export function useAssignOrder(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (staffId: string | null) => api.post<OrderDto>(`/orders/${orderId}/assign`, { staffId }),
    onSuccess: (order) => {
      queryClient.setQueryData(qk.order(orderId), order);
      void queryClient.invalidateQueries({ queryKey: qk.ordersRoot });
      void queryClient.invalidateQueries({ queryKey: qk.staffRoot });
    },
  });
}
