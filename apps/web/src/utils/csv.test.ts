import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['Sri Ganesh, Main Rd', 'He said "hi"\nbye']])).toBe(
      'a,b\r\n"Sri Ganesh, Main Rd","He said ""hi""\nbye"',
    );
  });

  it('neutralises spreadsheet formulas but keeps numbers numeric', () => {
    expect(toCsv(['x'], [['=HYPERLINK("evil")'], ['@SUM(A1)'], ['-300.00'], [-12]])).toBe(
      'x\r\n"\'=HYPERLINK(""evil"")"\r\n\'@SUM(A1)\r\n-300.00\r\n-12',
    );
  });

  it('writes empty cells for null', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, 0]])).toBe('a,b,c\r\n,,0');
  });
});
