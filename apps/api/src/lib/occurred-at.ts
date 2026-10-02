import { validationError } from './errors';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The moment an action really happened. Offline entries carry the phone's time so reports put
 * them on the right day. A phone clock running ahead is clamped to now (never in the future);
 * anything older than 30 days is refused rather than silently rewriting old books.
 */
export function resolveOccurredAt(value: string | null | undefined, now: Date = new Date()): Date {
  if (!value) return now;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw validationError('Invalid time.');
  if (at.getTime() > now.getTime()) return now;
  if (now.getTime() - at.getTime() > MAX_AGE_MS) {
    throw validationError('This entry is more than 30 days old. Please record it again with today’s date.', {
      occurredAt: 'Too old',
    });
  }
  return at;
}
