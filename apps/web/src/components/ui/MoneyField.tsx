import { forwardRef } from 'react';
import { useSession } from '../../features/auth/session';
import { Field, type FieldProps } from './Field';

const symbolCache = new Map<string, string>();
export function currencySymbol(currency: string): string {
  let symbol = symbolCache.get(currency);
  if (!symbol) {
    symbol =
      new Intl.NumberFormat('en-IN', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')
        ?.value ?? currency;
    symbolCache.set(currency, symbol);
  }
  return symbol;
}

/** Money input: decimal keypad, currency symbol from business settings, max 2 decimals. */
export const MoneyField = forwardRef<HTMLInputElement, Omit<FieldProps, 'prefix' | 'inputMode' | 'type'>>(
  function MoneyField(props, ref) {
    const { business } = useSession();
    return (
      <Field
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        prefix={currencySymbol(business.currency)}
        {...props}
      />
    );
  },
);

/** Keeps only digits and one decimal point with up to 2 places, as the user types. */
export function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole.slice(0, 10);
  return `${whole.slice(0, 10)}.${rest.join('').slice(0, 2)}`;
}
