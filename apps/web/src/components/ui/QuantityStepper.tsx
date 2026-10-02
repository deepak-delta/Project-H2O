import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../../utils/cn';

interface QuantityStepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  size?: 'md' | 'lg';
}

/** Big −/+ buttons for one-handed use, with a numeric-keypad input in the middle. */
export function QuantityStepper({ label, value, onChange, min = 0, max = 9999, hint, size = 'lg' }: QuantityStepperProps) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const btn = cn(
    'flex shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink transition-colors',
    'hover:bg-canvas active:bg-line/60 disabled:opacity-40',
    size === 'lg' ? 'size-13' : 'size-11',
  );

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="line-clamp-2 block text-[15px] leading-snug font-medium text-ink">
          {label}
        </label>
        {hint ? <p className="text-sm leading-snug text-muted">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className={btn} onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Fewer ${label}`}>
          <Minus className="size-5" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={String(value)}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            onChange(clamp(digits === '' ? 0 : Number(digits)));
          }}
          className={cn(
            'w-14 rounded-xl border border-line-strong bg-surface text-center font-semibold text-ink tabular outline-none',
            'focus:border-brand-600 focus:ring-2 focus:ring-brand-100',
            size === 'lg' ? 'h-13 text-xl' : 'h-11 text-lg',
          )}
        />
        <button type="button" className={btn} onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`More ${label}`}>
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  );
}
