import { ERROR_CODES, type ErrorCode } from '@wd/shared';

/**
 * An error whose message is safe to show to the user. Anything that is not an AppError is
 * treated as unexpected: logged in full, and replaced with a generic message in the response.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (message: string, fields?: Record<string, string>) =>
  new AppError(400, ERROR_CODES.VALIDATION, message, fields);

export const unauthenticated = (message = 'Please log in to continue.') =>
  new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);

export const forbidden = (message = "You don't have access to this.") =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);

/** Also used for records owned by another business, so their existence is never revealed. */
export const notFound = (what = 'Record') =>
  new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found.`);

export const conflict = (message: string) => new AppError(409, ERROR_CODES.CONFLICT, message);

export const rateLimited = (message = 'Too many attempts. Please wait a few minutes and try again.') =>
  new AppError(429, ERROR_CODES.RATE_LIMITED, message);

export const locked = (message: string) => new AppError(423, ERROR_CODES.LOCKED, message);

export const expired = (message: string) => new AppError(410, ERROR_CODES.EXPIRED, message);

export const unavailable = (message: string) => new AppError(503, ERROR_CODES.UNAVAILABLE, message);
