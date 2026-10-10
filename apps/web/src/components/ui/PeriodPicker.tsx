import { addDays, addMonths, endOfMonth, startOfMonth, zonedDateKey } from '@wd/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTimezone } from '../../hooks/useMoney';
import { FilterChips } from './Segmented';

export type PeriodPreset = 'today' | 'yesterday' | '7d' | 'month' | 'lastMonth' | '1m' | '3m' | '1y';

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
  label: string;
}

const LABELS: Record<PeriodPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  month: 'This month',
  lastMonth: 'Last month',
  '1m': 'Last 1 month',
  '3m': 'Last 3 months',
  '1y': 'Last 1 year',
};

export function periodFor(preset: PeriodPreset, today: string): Period {
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today, label: LABELS[preset] };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { preset, from: y, to: y, label: LABELS[preset] };
    }
    case '7d':
      return { preset, from: addDays(today, -6), to: today, label: LABELS[preset] };
    case 'month':
      return { preset, from: startOfMonth(today), to: today, label: LABELS[preset] };
    // Rolling periods ending today: 11 Oct back to 12 Sep is "last 1 month".
    case '1m':
    case '3m':
    case '1y': {
      const months = preset === '1m' ? 1 : preset === '3m' ? 3 : 12;
      return { preset, from: addDays(addMonths(today, -months), 1), to: today, label: LABELS[preset] };
    }
    case 'lastMonth': {
      const last = addDays(startOfMonth(today), -1);
      return { preset, from: startOfMonth(last), to: endOfMonth(last), label: LABELS[preset] };
    }
  }
}

/** Period chosen on a report screen, kept in the URL (?period=) so back/refresh keep it. */
export function usePeriod(defaultPreset: PeriodPreset, allowed: PeriodPreset[] = Object.keys(LABELS) as PeriodPreset[]) {
  const tz = useTimezone();
  const [params, setParams] = useSearchParams();
  const raw = params.get('period') as PeriodPreset | null;
  const preset = raw && allowed.includes(raw) ? raw : defaultPreset;
  const today = zonedDateKey(new Date(), tz);
  const period = useMemo(() => periodFor(preset, today), [preset, today]);
  const setPreset = (p: PeriodPreset) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('period', p);
        return next;
      },
      { replace: true },
    );
  return { period, setPreset, allowed };
}

export function PeriodChips({ value, onChange, allowed }: { value: PeriodPreset; onChange: (p: PeriodPreset) => void; allowed: PeriodPreset[] }) {
  return <FilterChips label="Period" value={value} onChange={onChange} options={allowed.map((p) => ({ value: p, label: LABELS[p] }))} />;
}
