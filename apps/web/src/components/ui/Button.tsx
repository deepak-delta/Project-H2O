import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
type Size = 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-800 disabled:bg-brand-700/50',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-canvas active:bg-line/60 disabled:text-muted',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 active:bg-brand-100 disabled:text-muted',
  danger: 'bg-bad text-white hover:bg-bad/90 active:bg-bad/90 disabled:bg-bad/50',
  dangerGhost: 'bg-transparent text-bad hover:bg-bad-bg active:bg-bad-bg disabled:text-muted',
};

const sizes: Record<Size, string> = {
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-13 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

/** Min 44px tall; disabled while loading so a double tap can never submit twice. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors select-none',
        'disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-5" /> : icon}
      {children}
    </button>
  );
}
