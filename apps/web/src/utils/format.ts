import { formatMoney } from '@wd/shared';

/**
 * Display helpers. Currency and timezone always come from the business settings, never
 * hard-coded in components.
 */
export interface DisplaySettings {
  currency: string;
  timezone: string;
  locale?: string;
}

const DEFAULT_LOCALE = 'en-IN';

export function money(amount: string | number, settings: Pick<DisplaySettings, 'currency' | 'locale'>): string {
  return formatMoney(amount, settings.currency, settings.locale ?? DEFAULT_LOCALE);
}

export function formatDate(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(
    new Date(iso),
  );
}
