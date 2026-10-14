/** Shape of every error response from the API. `message` is always safe to show to the user. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  LOCKED: 'LOCKED',
  /** A short-lived step (PIN reset, authenticator setup) ran out of time: start again. */
  EXPIRED: 'EXPIRED',
  /** A feature the server isn't configured for. */
  UNAVAILABLE: 'UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
