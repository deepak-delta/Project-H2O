import type { MeResponse, PinLoginInput, SignupInput } from '@wd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api } from '../../services/api';
import { queryPersister } from '../../offline/storage';

export const meQueryKey = ['me'] as const;

async function fetchMe(): Promise<MeResponse | null> {
  return (await api.get<{ me: MeResponse | null }>('/auth/session')).me;
}

/** The signed-in user, or null. `undefined` while the first check is in flight. */
export function useMe() {
  // Always re-checked when the app opens: a copy restored from the phone may be from another
  // login. While offline the restored copy is used as-is (the check is paused, not failed).
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 0 });
}

/**
 * Provided by the private route gate. Screens read the session from context rather than the
 * query so they never render with `null` in the instant between logout and the redirect.
 */
export const SessionContext = createContext<MeResponse | null>(null);

/** For screens that only render once signed in. */
export function useSession(): MeResponse {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession used outside an authenticated route');
  return session;
}

/**
 * Swaps the signed-in user. Every other cached query is dropped so one user's data can never
 * show up for another on a shared phone. (`clear()` would also detach the live `me` observer.)
 */
function useReplaceSession() {
  const queryClient = useQueryClient();
  return (me: MeResponse | null) => {
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
    queryClient.setQueryData(meQueryKey, me);
  };
}

export function usePinLogin() {
  const setSession = useReplaceSession();
  return useMutation({
    mutationFn: (input: PinLoginInput) => api.post<MeResponse>('/auth/login', input),
    onSuccess: setSession,
  });
}

export function useBiometricLogin() {
  const setSession = useReplaceSession();
  return useMutation({
    // WebAuthn code is only downloaded when someone actually uses biometric login.
    mutationFn: async () => (await import('./passkeys')).loginWithBiometrics(),
    onSuccess: setSession,
  });
}

export function useSignup() {
  const setSession = useReplaceSession();
  return useMutation({
    mutationFn: (input: SignupInput) => api.post<MeResponse>('/auth/signup', input),
    onSuccess: setSession,
  });
}

export function useLogout() {
  const replaceSession = useReplaceSession();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      replaceSession(null);
      // The saved copy of business data leaves the phone with the user (the outbox stays).
      void queryPersister.removeClient();
    },
  });
}
