import { ERROR_CODES, type ApiErrorBody } from '@wd/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../lib/errors';

function body(code: string, message: string, fields?: Record<string, string>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

/**
 * Users only ever see friendly messages; technical details go to the log.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err }, 'app error');
      return reply.status(err.statusCode).send(body(err.code, err.message, err.fields));
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return reply
          .status(409)
          .send(body(ERROR_CODES.CONFLICT, 'This record already exists. Please refresh and try again.'));
      }
      if (err.code === 'P2025') {
        return reply.status(404).send(body(ERROR_CODES.NOT_FOUND, 'Record not found.'));
      }
    }

    // Fastify's own client errors: bad JSON, payload too large, unsupported media type...
    const statusCode = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (statusCode === 429) {
      return reply
        .status(429)
        .send(body(ERROR_CODES.RATE_LIMITED, 'Too many requests. Please wait a minute and try again.'));
    }
    if (statusCode >= 400 && statusCode < 500) {
      req.log.warn({ err }, 'client error');
      return reply
        .status(statusCode)
        .send(body(ERROR_CODES.VALIDATION, 'The request could not be understood. Please try again.'));
    }

    req.log.error({ err }, 'unhandled error');
    return reply
      .status(500)
      .send(body(ERROR_CODES.INTERNAL, 'Something went wrong on our side. Please try again.'));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(body(ERROR_CODES.NOT_FOUND, 'Not found.'));
  });
}
