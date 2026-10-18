import { describe, expect, it } from 'vitest';
import { describeSchedule, isScheduleDue, nextScheduleDates, scheduleInputSchema, type ScheduleRule } from './schedule';

const rule = (r: Partial<ScheduleRule>): ScheduleRule => ({ frequency: 'DAILY', weekdays: [], intervalDays: null, monthDays: [], startDate: '2026-10-01', ...r });

describe('isScheduleDue', () => {
  it('never before the start date', () => {
    expect(isScheduleDue(rule({}), '2026-09-30')).toBe(false);
    expect(isScheduleDue(rule({}), '2026-10-01')).toBe(true);
  });

  it('chosen weekdays (19 Oct 2026 is a Monday)', () => {
    const mwf = rule({ frequency: 'WEEKDAYS', weekdays: [1, 3, 5] });
    expect(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23'].map((k) => isScheduleDue(mwf, k))).toEqual([false, true, false, true, true]);
  });

  it('every N days counts from the start date', () => {
    const alt = rule({ frequency: 'EVERY_N_DAYS', intervalDays: 2 });
    expect(nextScheduleDates(alt, '2026-10-01', 4)).toEqual(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07']);
    // Across a month end.
    expect(nextScheduleDates(rule({ frequency: 'EVERY_N_DAYS', intervalDays: 3, startDate: '2026-10-29' }), '2026-10-30', 2)).toEqual(['2026-11-01', '2026-11-04']);
  });

  it('monthly dates; the 31st falls on the last day of shorter months', () => {
    const r = rule({ frequency: 'MONTHLY', monthDays: [1, 31] });
    expect(nextScheduleDates(r, '2026-11-02', 3)).toEqual(['2026-11-30', '2026-12-01', '2026-12-31']);
    expect(isScheduleDue(rule({ frequency: 'MONTHLY', monthDays: [30] }), '2027-02-28')).toBe(true);
    expect(isScheduleDue(rule({ frequency: 'MONTHLY', monthDays: [28, 30] }), '2027-02-28')).toBe(true);
  });

  it('starts listing from the start date when that is later', () => {
    expect(nextScheduleDates(rule({ startDate: '2026-12-01' }), '2026-10-18', 2)).toEqual(['2026-12-01', '2026-12-02']);
  });
});

describe('describeSchedule', () => {
  it('reads like the owner would say it', () => {
    expect(describeSchedule(rule({}))).toBe('Every day');
    expect(describeSchedule(rule({ frequency: 'WEEKDAYS', weekdays: [5, 1, 3] }))).toBe('Mon, Wed, Fri');
    expect(describeSchedule(rule({ frequency: 'WEEKDAYS', weekdays: [0, 6] }))).toBe('Sat, Sun');
    expect(describeSchedule(rule({ frequency: 'EVERY_N_DAYS', intervalDays: 2 }))).toBe('Every other day');
    expect(describeSchedule(rule({ frequency: 'EVERY_N_DAYS', intervalDays: 3 }))).toBe('Every 3 days');
    expect(describeSchedule(rule({ frequency: 'MONTHLY', monthDays: [15, 1] }))).toBe('Monthly on the 1st and 15th');
    expect(describeSchedule(rule({ frequency: 'MONTHLY', monthDays: [2, 3, 22] }))).toBe('Monthly on the 2nd, 3rd and 22nd');
  });
});

describe('scheduleInputSchema', () => {
  const base = { startDate: '2026-10-19', items: [{ productId: 'p1', quantity: 2 }] };
  it('needs the details its pattern uses', () => {
    expect(scheduleInputSchema.safeParse({ ...base, frequency: 'DAILY' }).success).toBe(true);
    expect(scheduleInputSchema.safeParse({ ...base, frequency: 'WEEKDAYS' }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...base, frequency: 'EVERY_N_DAYS', intervalDays: 1 }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...base, frequency: 'MONTHLY', monthDays: [] }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...base, frequency: 'DAILY', startDate: '2026-02-30' }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...base, frequency: 'DAILY', items: [] }).success).toBe(false);
  });
});
