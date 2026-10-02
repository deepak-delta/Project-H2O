import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, endOfMonth, isDateKey, periodKeys, startOfMonth, zonedDateKey, zonedDayRange, zonedDayRangeForKey } from './date';

describe('zonedDayRange', () => {
  it('IST day starts at 18:30 UTC the previous day', () => {
    // 1 Oct 2026, 02:00 IST == 30 Sep 2026, 20:30 UTC
    const range = zonedDayRange('Asia/Kolkata', new Date('2026-09-30T20:30:00Z'));
    expect(range.key).toBe('2026-10-01');
    expect(range.start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-01T18:30:00.000Z');
  });

  it('late evening IST still belongs to the same local day', () => {
    const range = zonedDayRange('Asia/Kolkata', new Date('2026-10-01T18:29:59Z'));
    expect(range.key).toBe('2026-10-01');
  });

  it('handles a DST transition day (23 hours long)', () => {
    const range = zonedDayRangeForKey('2026-03-08', 'America/New_York');
    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('UTC is a plain calendar day', () => {
    const range = zonedDayRangeForKey('2026-10-01', 'UTC');
    expect(range.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('zonedDateKey matches the range key', () => {
    expect(zonedDateKey(new Date('2026-09-30T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-01');
  });
});

describe('date keys', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows month boundaries, including leap years', () => {
    expect(startOfMonth('2026-10-17')).toBe('2026-10-01');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });

  it('lists periods', () => {
    expect(periodKeys('2026-09-29', '2026-10-02', 'day')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(periodKeys('2026-11-15', '2027-01-03', 'month')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('validates keys', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-1-1')).toBe(false);
  });
});
