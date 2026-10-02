/**
 * Normalises a phone number to E.164-like form. A bare 10-digit number is treated as Indian
 * (+91) because that is the initial market; numbers with a leading + keep their country code.
 * Returns null when the input cannot be a valid phone number.
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+${defaultCountryCode}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return null;
}

/** "+919876543210" → "98765 43210" for display. */
export function formatPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `${match[1]} ${match[2]}` : phone;
}
