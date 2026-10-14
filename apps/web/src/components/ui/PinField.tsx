import { useId, useRef, useState } from 'react';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../utils/cn';

const LENGTH = 6;

interface PinFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
  autoComplete?: 'current-password' | 'new-password';
  /** Called when the 6th digit is entered — lets login submit without an extra tap. */
  onComplete?: (value: string) => void;
  /** Adds a Show/Hide button so a new PIN can be checked before saving. */
  revealable?: boolean;
}

/**
 * Six-digit PIN entry: one real (password, numeric keypad) input drawn as six boxes, so
 * password managers, paste and screen readers all keep working.
 */
export function PinField({
  label,
  value,
  onChange,
  error,
  autoFocus,
  autoComplete = 'current-password',
  onComplete,
  revealable,
}: PinFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          {label}
        </label>
        {revealable ? (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-pressed={shown}
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            className="-my-2 flex h-11 items-center gap-1.5 px-1 text-sm font-semibold text-brand-700"
          >
            {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {shown ? 'Hide' : 'Show'}
          </button>
        ) : null}
      </div>
      <div className="relative" onClick={() => inputRef.current?.focus()}>
        <input
          ref={inputRef}
          id={id}
          type={shown ? 'text' : 'password'}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={autoComplete}
          maxLength={LENGTH}
          autoFocus={autoFocus}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, LENGTH);
            onChange(digits);
            if (digits.length === LENGTH) onComplete?.(digits);
          }}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
        <div className="grid grid-cols-6 gap-2" aria-hidden>
          {Array.from({ length: LENGTH }, (_, i) => {
            const filled = i < value.length;
            const active = focused && i === Math.min(value.length, LENGTH - 1);
            return (
              <div
                key={i}
                className={cn(
                  'flex h-13 items-center justify-center rounded-xl border bg-surface transition-colors',
                  error ? 'border-bad' : active ? 'border-brand-600 ring-2 ring-brand-100' : 'border-line-strong',
                )}
              >
                {filled ? (
                  shown ? (
                    <span className="text-xl font-semibold text-ink tabular">{value[i]}</span>
                  ) : (
                    <span className="size-3 rounded-full bg-ink" />
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-sm text-bad">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
