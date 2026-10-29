import type { Page } from '@wd/shared';
import { validationError } from './errors';

/**
 * Keyset cursors over (timestamp, id), newest first. Stable even while new rows are inserted,
 * unlike OFFSET paging.
 */
export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime()) || !id) throw validationError('Invalid page cursor.');
  return { at, id };
}

/** Prisma `where` fragment selecting rows strictly older than the cursor. */
export function olderThan<K extends string>(field: K, cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [{ [field]: { lt: cursor.at } }, { [field]: cursor.at, id: { lt: cursor.id } }],
  } as Record<string, unknown>;
}

/** Prisma `where` fragment selecting rows strictly newer than the cursor (oldest-first lists). */
export function newerThan<K extends string>(field: K, cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [{ [field]: { gt: cursor.at } }, { [field]: cursor.at, id: { gt: cursor.id } }],
  } as Record<string, unknown>;
}

/** Fetch `limit + 1` rows, then call this to split off the next cursor. */
export function toPage<T, R>(
  rows: T[],
  limit: number,
  key: (row: T) => { at: Date; id: string },
  map: (row: T) => R,
): Page<R> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map(map),
    nextCursor: hasMore && last ? encodeCursor(key(last).at, key(last).id) : null,
  };
}
