import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

/**
 * Vercel Web Analytics (visits, pages) and Speed Insights (real-user loading speed). Both are
 * cookieless and load their scripts from this site's own /_vercel/ path, so the strict
 * Content-Security-Policy stays as it is. Only in builds deployed on Vercel.
 */
export function VercelInsights() {
  if (import.meta.env.VITE_VERCEL_INSIGHTS !== '1') return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
