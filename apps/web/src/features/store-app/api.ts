import { useQuery } from '@tanstack/react-query';
import type { StoreHomeDto } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

export function useStoreHome() {
  return useQuery({ queryKey: qk.storeHome, queryFn: () => api.get<StoreHomeDto>('/store/home') });
}
