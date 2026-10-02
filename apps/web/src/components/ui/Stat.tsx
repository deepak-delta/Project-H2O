import { toMinor } from '@wd/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../utils/cn';

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'bad' | 'warn';
  to?: string;
}

/** Compact number tile. Tappable when it leads to the detail behind the number. */
export function Stat({ label, value, hint, tone = 'default', to }: StatProps) {
  const body = (
    <>
      <span className="block text-[13px] text-muted">{label}</span>
      <span
        className={cn(
          'mt-0.5 block truncate text-xl font-semibold tabular',
          tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
      >
        {value}
      </span>
      {hint ? <span className="mt-0.5 block truncate text-xs text-muted">{hint}</span> : null}
    </>
  );
  const cls = 'block min-w-0 rounded-xl bg-canvas px-3 py-2.5';
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:bg-line/50 active:bg-line/70')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** "Owes ₹300" / "Advance ₹150" / "Settled" — balance in words, not just a signed number. */
export function BalanceText({ balance, format, className }: { balance: string; format: (v: string) => string; className?: string }) {
  const n = toMinor(balance);
  if (n > 0) return <span className={cn('font-semibold text-bad tabular', className)}>Owes {format(balance)}</span>;
  if (n < 0) return <span className={cn('font-semibold text-ok tabular', className)}>Advance {format(balance.replace('-', ''))}</span>;
  return <span className={cn('text-muted', className)}>Settled</span>;
}
