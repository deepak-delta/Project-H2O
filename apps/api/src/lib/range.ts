import { dateRangeSchema, zonedDayRangeForKey, type DateRange } from '@wd/shared';
import { getBusinessSettings } from './business';
import type { Db } from './db';
import { parse } from './validate';

export interface ResolvedRange extends DateRange {
  timezone: string;
  /** Inclusive UTC start of `from` in the business timezone. */
  start: Date;
  /** Exclusive UTC end of `to` in the business timezone. */
  end: Date;
}

/** Parses ?from=&to= (local dates) and converts them to UTC bounds for queries. */
export async function resolveRange(db: Db, supplierId: string, query: unknown): Promise<ResolvedRange> {
  const range = parse(dateRangeSchema, query);
  const { timezone } = await getBusinessSettings(db, supplierId);
  return {
    ...range,
    timezone,
    start: zonedDayRangeForKey(range.from, timezone).start,
    end: zonedDayRangeForKey(range.to, timezone).end,
  };
}
