import { useEffect } from 'react';

const IS_QA = import.meta.env.VITE_APP_ENV === 'qa';

/**
 * Marks the QA build (Vercel preview with its own test database) so testers never mistake it
 * for the live app: a small tab at the top of every screen and "QA ·" in the window title.
 * Renders nothing in production.
 */
export function QaBadge() {
  useEffect(() => {
    if (IS_QA && !document.title.startsWith('QA · ')) document.title = `QA · ${document.title}`;
  }, []);
  if (!IS_QA) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-[70] -translate-x-1/2 rounded-b-md bg-warn px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-white"
    >
      QA · test data
    </div>
  );
}
