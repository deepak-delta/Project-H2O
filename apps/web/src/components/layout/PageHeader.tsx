import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Shows a back button. Pass a path for a fixed parent, or true to go back in history. */
  back?: string | true;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, back, action }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-canvas/95 pt-safe backdrop-blur-sm">
      <div className="flex min-h-14 items-center gap-1 px-safe">
        {back ? (
          <button
            type="button"
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-line/50"
            aria-label="Back"
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-lg leading-tight font-semibold text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

/** Standard page body: side gutters + bottom padding so nothing hides behind the nav. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5 px-safe pt-4 pb-6">{children}</div>;
}
