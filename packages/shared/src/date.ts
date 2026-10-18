/**
 * Day boundaries in a business timezone. Timestamps are stored in UTC; "today" for an
 * Indian supplier starts at 00:00 IST, which is 18:30 UTC the previous day.
 */

function wallClockParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds the zone is ahead of UTC at a given instant (IST → +19800000). */
function zoneOffset(instant: number, timeZone: string): number {
  const p = wallClockParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight for the given calendar date in the zone. */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffset(guess, timeZone);
  // Re-evaluate at the candidate instant so DST transitions land correctly.
  return new Date(guess - zoneOffset(first, timeZone));
}

/** Hour of the day (0–23) on the zone's wall clock. */
export function zonedHour(at: Date, timeZone: string): number {
  return wallClockParts(at.getTime(), timeZone).hour;
}

/** "2026-10-01" — the calendar date of `at` in the zone. */
export function zonedDateKey(at: Date, timeZone: string): string {
  const p = wallClockParts(at.getTime(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface DayRange {
  /** Inclusive UTC start. */
  start: Date;
  /** Exclusive UTC end. */
  end: Date;
  /** Local calendar date, YYYY-MM-DD. */
  key: string;
}

/** The local calendar day containing `at` (default: now). */
export function zonedDayRange(timeZone: string, at: Date = new Date()): DayRange {
  const p = wallClockParts(at.getTime(), timeZone);
  return dayRangeFor(p.year, p.month, p.day, timeZone);
}

/** Range for an explicit YYYY-MM-DD in the zone. */
export function zonedDayRangeForKey(key: string, timeZone: string): DayRange {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid date key: ${key}`);
  return dayRangeFor(Number(match[1]), Number(match[2]), Number(match[3]), timeZone);
}

function dayRangeFor(year: number, month: number, day: number, timeZone: string): DayRange {
  const start = localMidnight(year, month, day, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { start, end, key };
}

// ─── Calendar arithmetic on YYYY-MM-DD keys (timezone-free) ───────────────────

function keyToUtc(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid date key: ${key}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function utcToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && utcToKey(keyToUtc(value)) === value;
}

export function addDays(key: string, days: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToKey(d);
}

/** Same day `months` later (or earlier), clamped to the month's last day: 31 Mar − 1 month = 28/29 Feb. */
export function addMonths(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return utcToKey(first);
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: string): string {
  const d = keyToUtc(startOfMonth(key));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return utcToKey(d);
}

/** Whole days from `from` to `to`, inclusive of both. */
export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtc(to).getTime() - keyToUtc(from).getTime()) / 86_400_000) + 1;
}

/** Every key from `from` to `to` inclusive, by day or by month ("YYYY-MM"). */
export function periodKeys(from: string, to: string, unit: 'day' | 'month'): string[] {
  const keys: string[] = [];
  if (unit === 'day') {
    for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k);
  } else {
    for (let k = startOfMonth(from); k <= to; k = addDays(endOfMonth(k), 1)) keys.push(k.slice(0, 7));
  }
  return keys;
}
