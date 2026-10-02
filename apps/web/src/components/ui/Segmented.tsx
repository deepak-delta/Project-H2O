import { cn } from '../../utils/cn';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  size?: 'md' | 'lg';
}

/** Single-choice toggle (radio group) with large touch targets. */
export function Segmented<T extends string>({ label, value, onChange, options, size = 'md' }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-line/40 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-lg px-2 text-[15px] font-medium transition-colors',
              size === 'lg' ? 'h-12' : 'h-10',
              active ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface ChipsProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

/** Horizontally scrolling filter chips. */
export function FilterChips<T extends string>({ label, value, onChange, options }: ChipsProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors',
              active ? 'border-brand-700 bg-brand-700 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-canvas',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
