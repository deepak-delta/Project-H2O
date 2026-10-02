import type { ReactNode } from 'react';
import { Droplets } from 'lucide-react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas pt-safe pb-safe">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-5 pt-10 pb-6">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Droplets className="size-5" aria-hidden />
          </span>
          <span className="text-base font-semibold text-ink">Water Delivery</span>
        </div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-[15px] text-muted">{subtitle}</p> : null}
        <div className="mt-7 flex flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
