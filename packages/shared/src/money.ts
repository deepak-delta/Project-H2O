/**
 * Money helpers. Amounts travel over the wire as decimal strings ("1250.50") and are
 * stored as NUMERIC(12,2). All arithmetic happens on integer minor units (paise/cents)
 * so floating-point rounding can never creep into balances.
 */

export type Minor = number;

const MONEY_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/;

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}

/** "1250.5" → 125050. Throws on anything that is not a plain decimal with ≤ 2 places. */
export function toMinor(value: string): Minor {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new Error(`Invalid money amount: ${value}`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error(`Money amount out of range: ${value}`);
  return negative ? -minor : minor;
}

/** 125050 → "1250.50" */
export function fromMinor(minor: Minor): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`Invalid minor amount: ${minor}`);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function sumMinor(values: readonly Minor[]): Minor {
  return values.reduce((total, v) => total + v, 0);
}

/** Unit price × integer quantity, exact. */
export function lineTotalMinor(unitPrice: Minor, quantity: number): Minor {
  if (!Number.isInteger(quantity)) throw new Error(`Quantity must be a whole number: ${quantity}`);
  return unitPrice * quantity;
}

export function addMoney(...values: string[]): string {
  return fromMinor(sumMinor(values.map(toMinor)));
}

export function subtractMoney(a: string, b: string): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const diff = toMinor(a) - toMinor(b);
  return diff === 0 ? 0 : diff < 0 ? -1 : 1;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/** Display formatting, e.g. formatMoney("1250", "INR") → "₹1,250". Paise shown only when non-zero. */
export function formatMoney(amount: string | Minor, currency = 'INR', locale = 'en-IN'): string {
  const minor = typeof amount === 'number' ? amount : toMinor(amount);
  const hasFraction = minor % 100 !== 0;
  const key = `${locale}|${currency}|${hasFraction}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    });
    formatterCache.set(key, formatter);
  }
  // Division by 100 is display-only; the value is never fed back into arithmetic.
  return formatter.format(minor / 100);
}
