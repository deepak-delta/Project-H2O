import { fromMinor, toMinor, type Minor } from '@wd/shared';
import type { Prisma } from '../generated/prisma/client';

type DecimalLike = Prisma.Decimal | { toFixed(digits: number): string };

/** NUMERIC(12,2) → "1250.00" */
export function decToString(value: DecimalLike | null | undefined): string {
  return value ? value.toFixed(2) : '0.00';
}

/** NUMERIC(12,2) → integer minor units, exactly. */
export function decToMinor(value: DecimalLike | null | undefined): Minor {
  return value ? toMinor(value.toFixed(2)) : 0;
}

/** Minor units → string accepted by Prisma for Decimal columns. */
export function minorToDec(minor: Minor): string {
  return fromMinor(minor);
}

/** A raw-SQL SUM() over NUMERIC(12,2): Decimal, string or NULL (no rows) → minor units. */
export function sqlSumToMinor(value: unknown): Minor {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && 'toFixed' in value) return toMinor((value as DecimalLike).toFixed(2));
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return toMinor(String(value));
  }
  throw new Error(`Unexpected SQL sum value: ${typeof value}`);
}
