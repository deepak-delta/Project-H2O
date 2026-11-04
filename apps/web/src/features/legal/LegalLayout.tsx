import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';

/** Shown on both documents. Update when the text changes. */
export const LEGAL_UPDATED = '4 November 2026';

/**
 * Plain reading layout for the legal pages. They open with or without a login (sign-up screen,
 * app-store listings), so "back" goes to the previous screen when there is one, else the app.
 */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const hasHistory = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <div className="min-h-dvh bg-canvas">
      <PageHeader title={title} back={hasHistory ? true : '/'} />
      <PageBody>
        <article className="mx-auto flex max-w-2xl flex-col gap-5 pb-10 text-[15px] leading-relaxed text-ink-2">
          <p className="text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
          {children}
        </article>
      </PageBody>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** "Privacy policy · Terms and conditions" links, for the sign-up screen and menus. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <span className={className}>
      <Link to="/terms" className="font-semibold text-brand-700">
        Terms and conditions
      </Link>{' '}
      and{' '}
      <Link to="/privacy" className="font-semibold text-brand-700">
        Privacy policy
      </Link>
    </span>
  );
}
