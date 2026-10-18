import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduleDto, ScheduleInput } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

export function useSchedule(storeId: string, enabled = true) {
  return useQuery({
    queryKey: qk.schedule(storeId),
    queryFn: async () => (await api.get<{ schedule: ScheduleDto | null }>(`/stores/${storeId}/schedule`)).schedule,
    enabled,
  });
}

/** Saving may make today's order straight away, so order lists refresh too. */
export function useSaveSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, input }: { storeId: string; input: ScheduleInput }) =>
      api.put<{ schedule: ScheduleDto }>(`/stores/${storeId}/schedule`, input),
    onSuccess: ({ schedule }) => {
      queryClient.setQueryData(qk.schedule(schedule.storeId), schedule);
      void queryClient.invalidateQueries({ queryKey: qk.ordersRoot });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useDeleteSchedule(storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/stores/${storeId}/schedule`),
    onSuccess: () => queryClient.setQueryData(qk.schedule(storeId), null),
  });
}
