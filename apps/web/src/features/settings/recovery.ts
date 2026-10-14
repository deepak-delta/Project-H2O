import { useQuery } from '@tanstack/react-query';
import type { RecoveryStatus } from '@wd/shared';
import { api } from '../../services/api';

export const recoveryStatusKey = ['auth', 'recovery'] as const;

export function useRecoveryStatus() {
  return useQuery({ queryKey: recoveryStatusKey, queryFn: () => api.get<RecoveryStatus>('/auth/recovery') });
}

/** "123456" from what was typed or pasted ("123 456"). */
export const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);
