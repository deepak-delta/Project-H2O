import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatMoney,
  fromMinor,
  lineTotalMinor,
  subtractMoney,
  toMinor,
} from './money';

describe('toMinor / fromMinor', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1.5', 150],
    ['1.05', 105],
    ['1250.50', 125050],
    ['-300', -30000],
    [' 42.10 ', 4210],
  ])('parses %s', (input, expected) => {
    expect(toMinor(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '1,000', '1e3', '--1', '.5', 'NaN'])('rejects %s', (input) => {
    expect(() => toMinor(input)).toThrow();
  });

  it('round-trips', () => {
    for (const v of ['0.00', '0.01', '0.10', '999.99', '-12.30', '100000.00']) {
      expect(fromMinor(toMinor(v))).toBe(v);
    }
  });
});

describe('arithmetic is exact', () => {
  it('0.1 + 0.2 is exactly 0.30', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.30');
  });

  it('order 500, paid 200 leaves 300 credit', () => {
    expect(subtractMoney('500', '200')).toBe('300.00');
  });

  it('line totals multiply exactly', () => {
    expect(fromMinor(lineTotalMinor(toMinor('33.33'), 3))).toBe('99.99');
    expect(() => lineTotalMinor(100, 1.5)).toThrow();
  });

  it('compares', () => {
    expect(compareMoney('10', '10.00')).toBe(0);
    expect(compareMoney('9.99', '10')).toBe(-1);
    expect(compareMoney('10.01', '10')).toBe(1);
  });
});

describe('formatMoney', () => {
  it('formats INR with Indian grouping and hides zero paise', () => {
    expect(formatMoney('1250', 'INR')).toBe('₹1,250');
    expect(formatMoney('125000', 'INR')).toBe('₹1,25,000');
    expect(formatMoney('1250.5', 'INR')).toBe('₹1,250.50');
  });

  it('respects the configured currency', () => {
    expect(formatMoney('10', 'USD', 'en-US')).toBe('$10');
  });
});
