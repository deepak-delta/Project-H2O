import type { ApiErrorBody } from '@wd/shared';

/** Error with a message that is always safe and useful to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** A request that hangs on a weak signal is treated like being offline (and can be queued). */
const REQUEST_TIMEOUT_MS = 20_000;

let onUnauthenticated: (() => void) | null = null;
/** Called once by the app so any 401 (expired session) sends the user back to login. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new ApiError(
      0,
      'NETWORK',
      timedOut ? 'The connection is too slow right now. Please try again.' : "You're offline or the connection dropped. Please try again.",
    );
  }

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;

  const error = (data as Partial<ApiErrorBody> | null)?.error;
  if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/passkeys/login')) {
    onUnauthenticated?.();
  }
  throw new ApiError(
    response.status,
    error?.code ?? 'INTERNAL',
    error?.message ?? 'Something went wrong. Please try again.',
    error?.fields,
  );
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return err instanceof ApiError ? err.message : fallback;
}
