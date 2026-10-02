import { useCallback } from 'react';
import { useSession } from '../features/auth/session';
import { money } from '../utils/format';

/** Formats amounts in the business's own currency. */
export function useMoney(): (amount: string | number) => string {
  const { business } = useSession();
  return useCallback((amount) => money(amount, { currency: business.currency }), [business.currency]);
}

export function useTimezone(): string {
  return useSession().business.timezone;
}
