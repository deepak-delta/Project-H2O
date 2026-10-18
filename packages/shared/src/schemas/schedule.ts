import { z } from 'zod';
import { addDays, daysBetween, endOfMonth, isDateKey } from '../date';
import { optionalNote } from './sales';

// ─── Regular (recurring) deliveries to a client ─────────────────────────────

export const SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKDAYS', 'EVERY_N_DAYS', 'MONTHLY'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/** Local hour (business timezone) when the day's regular deliveries become orders. */
export const SCHEDULE_HOUR = 6;

/** 0 = Sunday … 6 = Saturday, as Date#getUTCDay() of a date key. */
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const dateKey = z.string().refine(isDateKey, 'Choose a date');

export const scheduleInputSchema = z
  .object({
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    weekdays: z.array(z.int().min(0).max(6)).max(7).default([]),
    intervalDays: z.int().min(2, 'At least every 2 days').max(60, 'At most every 60 days').nullish(),
    monthDays: z.array(z.int().min(1).max(31)).max(31).default([]),
    /** First day it can happen (also the day "every N days" counts from). */
    startDate: dateKey,
    items: z
      .array(z.object({ productId: z.string().min(1), quantity: z.int().min(1, 'At least 1').max(999) }))
      .min(1, 'Add at least one product')
      .max(20),
    /** Member of staff who delivers it; null = the owner. */
    assignedToId: z.string().min(1).nullish(),
    active: z.boolean().default(true),
    notes: optionalNote,
  })
  .superRefine((s, ctx) => {
    if (s.frequency === 'WEEKDAYS' && s.weekdays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose at least one day' });
    }
    if (s.frequency === 'EVERY_N_DAYS' && !s.intervalDays) {
      ctx.addIssue({ code: 'custom', path: ['intervalDays'], message: 'How many days apart?' });
    }
    if (s.frequency === 'MONTHLY' && s.monthDays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['monthDays'], message: 'Choose at least one date' });
    }
    if (new Set(s.items.map((i) => i.productId)).size !== s.items.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Each product only once' });
    }
  });
export type ScheduleInput = z.input<typeof scheduleInputSchema>;

/** The parts of a schedule that decide which days it falls on. */
export interface ScheduleRule {
  frequency: ScheduleFrequency;
  weekdays: number[];
  intervalDays: number | null;
  monthDays: number[];
  startDate: string;
}

export interface ScheduleDto extends ScheduleRule {
  id: string;
  storeId: string;
  items: { productId: string; productName: string; quantity: number }[];
  assignedTo: { id: string; name: string } | null;
  active: boolean;
  notes: string | null;
  /** Next days it will happen, from today (business timezone). Empty when paused. */
  nextDates: string[];
}

const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

/** Does the schedule fall on this local calendar day? */
export function isScheduleDue(rule: ScheduleRule, key: string): boolean {
  if (key < rule.startDate) return false;
  switch (rule.frequency) {
    case 'DAILY':
      return true;
    case 'WEEKDAYS':
      return rule.weekdays.includes(weekdayOf(key));
    case 'EVERY_N_DAYS':
      return !!rule.intervalDays && (daysBetween(rule.startDate, key) - 1) % rule.intervalDays === 0;
    case 'MONTHLY': {
      const day = Number(key.slice(8, 10));
      if (rule.monthDays.includes(day)) return true;
      // "On the 31st" still happens in shorter months: on their last day.
      const last = Number(endOfMonth(key).slice(8, 10));
      return day === last && rule.monthDays.some((d) => d > last);
    }
  }
}

/** The next `count` days (from `from`, inclusive) the schedule falls on; looks ahead a year at most. */
export function nextScheduleDates(rule: ScheduleRule, from: string, count = 3): string[] {
  const out: string[] = [];
  for (let k = from < rule.startDate ? rule.startDate : from, i = 0; out.length < count && i < 400; k = addDays(k, 1), i++) {
    if (isScheduleDue(rule, k)) out.push(k);
  }
  return out;
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
};

/** "Every day", "Mon, Wed, Fri", "Every 2 days", "On the 1st and 15th". */
export function describeSchedule(rule: ScheduleRule): string {
  switch (rule.frequency) {
    case 'DAILY':
      return 'Every day';
    case 'WEEKDAYS':
      return rule.weekdays.length === 7
        ? 'Every day'
        : [...rule.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_SHORT[d]).join(', ');
    case 'EVERY_N_DAYS':
      return rule.intervalDays === 2 ? 'Every other day' : `Every ${rule.intervalDays ?? '?'} days`;
    case 'MONTHLY': {
      const days = [...rule.monthDays].sort((a, b) => a - b).map(ordinal);
      const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)}` : (days[0] ?? '');
      return `Monthly on the ${list}`;
    }
  }
}
