import {
  addDays,
  nextScheduleDates,
  scheduleInputSchema,
  WEEKDAY_SHORT,
  zonedDateKey,
  type ProductDto,
  type ScheduleDto,
  type ScheduleFrequency,
  type ScheduleInput,
} from '@wd/shared';
import { CalendarClock } from 'lucide-react';
import { Card, SectionTitle } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { cn } from '../../utils/cn';
import { useStaffList } from '../staff/api';

/** What the owner is editing; turned into a ScheduleInput when saved. */
export interface ScheduleDraft {
  frequency: ScheduleFrequency;
  weekdays: number[];
  intervalDays: number;
  monthDays: number[];
  startDate: string;
  quantities: Record<string, number>;
  assignedToId: string;
  notes: string;
  active: boolean;
}

const FREQUENCIES: { value: ScheduleFrequency; label: string }[] = [
  { value: 'DAILY', label: 'Every day' },
  { value: 'WEEKDAYS', label: 'Some weekdays' },
  { value: 'EVERY_N_DAYS', label: 'Every few days' },
  { value: 'MONTHLY', label: 'Monthly' },
];

/** Monday first, as people read a week here. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function newDraft(timezone: string, products: ProductDto[]): ScheduleDraft {
  return {
    frequency: 'DAILY',
    weekdays: [],
    intervalDays: 2,
    monthDays: [],
    // Starts tomorrow: today's water is usually already sorted when a client is set up.
    startDate: addDays(zonedDateKey(new Date(), timezone), 1),
    quantities: Object.fromEntries(products.slice(0, 1).map((p) => [p.id, 1])),
    assignedToId: '',
    notes: '',
    active: true,
  };
}

export function draftFrom(s: ScheduleDto): ScheduleDraft {
  return {
    frequency: s.frequency,
    weekdays: s.weekdays,
    intervalDays: s.intervalDays ?? 2,
    monthDays: s.monthDays,
    startDate: s.startDate,
    quantities: Object.fromEntries(s.items.map((i) => [i.productId, i.quantity])),
    assignedToId: s.assignedTo?.id ?? '',
    notes: s.notes ?? '',
    active: s.active,
  };
}

/** The input to save, or the first problem to show. */
export function draftToInput(d: ScheduleDraft): { input: ScheduleInput } | { error: string } {
  const input: ScheduleInput = {
    frequency: d.frequency,
    weekdays: d.weekdays,
    intervalDays: d.frequency === 'EVERY_N_DAYS' ? d.intervalDays : null,
    monthDays: d.monthDays,
    startDate: d.startDate,
    items: Object.entries(d.quantities)
      .filter(([, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity })),
    assignedToId: d.assignedToId || null,
    notes: d.notes.trim() || null,
    active: d.active,
  };
  const parsed = scheduleInputSchema.safeParse(input);
  if (parsed.success) return { input };
  return { error: parsed.error.issues[0]?.message ?? 'Check the regular delivery.' };
}

/** "Mon 19 Oct" (the key is a calendar date, so it is read as UTC to avoid shifting a day). */
function dayLabel(key: string): string {
  const parts = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(new Date(`${key}T00:00:00Z`));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** "Next: Mon 19 Oct · Wed 21 Oct · Fri 23 Oct". */
export function nextDatesText(dates: string[]): string {
  return dates.length ? `Next: ${dates.map(dayLabel).join(' · ')}` : 'No upcoming days';
}

function toggle(list: number[], n: number): number[] {
  return list.includes(n) ? list.filter((x) => x !== n) : [...list, n];
}

const chip = (on: boolean) =>
  cn(
    'rounded-xl border text-[15px] font-medium transition-colors',
    on ? 'border-brand-700 bg-brand-700 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-canvas',
  );

export function ScheduleEditor({
  draft,
  onChange,
  products,
  today,
}: {
  draft: ScheduleDraft;
  onChange: (d: ScheduleDraft) => void;
  products: ProductDto[];
  /** Business-local date key, for the preview. */
  today: string;
}) {
  const staff = useStaffList();
  const activeStaff = staff.data?.filter((s) => s.active) ?? [];
  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => onChange({ ...draft, [key]: value });
  const preview = nextScheduleDates(
    { frequency: draft.frequency, weekdays: draft.weekdays, intervalDays: draft.intervalDays, monthDays: draft.monthDays, startDate: draft.startDate || today },
    today,
    3,
  );

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>How often?</SectionTitle>
        <Card className="flex flex-col gap-4 p-4">
          <div role="radiogroup" aria-label="How often" className="grid grid-cols-2 gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={draft.frequency === f.value}
                onClick={() => set('frequency', f.value)}
                className={cn('h-11 px-2', chip(draft.frequency === f.value))}
              >
                {f.label}
              </button>
            ))}
          </div>

          {draft.frequency === 'WEEKDAYS' ? (
            <div role="group" aria-label="Which days" className="grid grid-cols-7 gap-1">
              {WEEK.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.weekdays.includes(d)}
                  onClick={() => set('weekdays', toggle(draft.weekdays, d))}
                  className={cn('h-11 px-0 text-sm', chip(draft.weekdays.includes(d)))}
                >
                  {WEEKDAY_SHORT[d]}
                </button>
              ))}
            </div>
          ) : null}

          {draft.frequency === 'EVERY_N_DAYS' ? (
            <QuantityStepper
              size="md"
              label="Every how many days?"
              hint={draft.intervalDays === 2 ? 'Every other day' : `Once in ${draft.intervalDays} days`}
              min={2}
              max={60}
              value={draft.intervalDays}
              onChange={(v) => set('intervalDays', v)}
            />
          ) : null}

          {draft.frequency === 'MONTHLY' ? (
            <div role="group" aria-label="Dates of the month" className="grid grid-cols-7 gap-1">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.monthDays.includes(d)}
                  onClick={() => set('monthDays', toggle(draft.monthDays, d))}
                  className={cn('h-11 px-0 text-sm tabular', chip(draft.monthDays.includes(d)))}
                >
                  {d}
                </button>
              ))}
            </div>
          ) : null}

          <Field
            label={draft.frequency === 'EVERY_N_DAYS' ? 'First delivery (counted from)' : 'Starting from'}
            type="date"
            value={draft.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          <p className="flex items-start gap-2 text-sm text-ink-2">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
            <span>
              {nextDatesText(preview)}. The order appears under Pending at 6 AM on each of these days.
            </span>
          </p>
        </Card>
      </section>

      <section>
        <SectionTitle>How many each time?</SectionTitle>
        <Card className="flex flex-col gap-4 p-4">
          {products.map((p) => (
            <QuantityStepper
              key={p.id}
              label={p.name}
              value={draft.quantities[p.id] ?? 0}
              onChange={(v) => set('quantities', { ...draft.quantities, [p.id]: v })}
            />
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle>Who delivers?</SectionTitle>
        <Card className="flex items-center justify-between gap-3 px-4 py-3">
          <label htmlFor="regular-assignee" className="text-[15px] font-medium text-ink-2">
            Delivered by
          </label>
          <select
            id="regular-assignee"
            className="h-11 min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-ink"
            value={draft.assignedToId}
            onChange={(e) => set('assignedToId', e.target.value)}
          >
            <option value="">Me (owner)</option>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Card>
        <p className="mt-2 px-1 text-sm text-muted">
          {draft.assignedToId
            ? 'They get it automatically each time, and a notification that morning.'
            : 'You get a notification that morning.'}
        </p>
      </section>

      <Field label="Note for each delivery (optional)" placeholder="e.g. Back gate, before 9am" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
    </div>
  );
}
