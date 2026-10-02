import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12345', 'abcdefghij', '+12'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('formatPhone', () => {
  it('groups Indian numbers', () => {
    expect(formatPhone('+919876543210')).toBe('98765 43210');
  });
});
