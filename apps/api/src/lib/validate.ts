import type { z } from 'zod';
import { validationError } from './errors';

/** Parses untrusted input; throws a 400 with per-field messages the UI can show inline. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const first = result.error.issues[0]?.message ?? 'Please check the highlighted fields.';
  throw validationError(first, fields);
}
