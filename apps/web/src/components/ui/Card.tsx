import type { HTMLAttributes, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../../utils/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)}
      {...rest}
    />
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}

/** Mobile list row (min 56px). Renders as a link, a button, or plain content. */
export function ListRow({ title, subtitle, leading, trailing, to, onClick, chevron, className }: ListRowProps) {
  const content = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        {subtitle ? <span className="block truncate text-sm text-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right">{trailing}</span> : null}
      {chevron || to ? <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden /> : null}
    </>
  );
  const base = cn('flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left', className);
  const interactive = 'transition-colors hover:bg-canvas active:bg-line/50';

  if (to) {
    return (
      <Link to={to} className={cn(base, interactive)}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, interactive)}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}

export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn('divide-y divide-line overflow-hidden', className)}>{children}</Card>;
}
