import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string;
  error?: string;
  hint?: ReactNode;
  prefix?: ReactNode;
}

/** Labelled text input. Errors are shown in text with an icon, never by colour alone. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, prefix, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <div
        className={cn(
          'flex h-12 items-center rounded-xl border bg-surface px-3.5 transition-colors',
          'focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100',
          error ? 'border-bad' : 'border-line-strong',
        )}
      >
        {prefix ? <span className="mr-2 text-base text-muted tabular">{prefix}</span> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="h-full w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-muted/70"
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="flex items-center gap-1.5 text-sm text-bad">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
