import { describe, expect, it } from 'vitest';
import { safeAppPath } from './platform';
import { shellStatus } from './shell';

describe('shellStatus', () => {
  const shell = { min: 3, latest: 5 };
  it('blocks apps older than the minimum', () => {
    expect(shellStatus(2, shell)).toBe('update-required');
    expect(shellStatus(Number.NaN, shell)).toBe('update-required');
  });
  it('suggests, without forcing, a newer app', () => {
    expect(shellStatus(3, shell)).toBe('update-available');
    expect(shellStatus(4, shell)).toBe('update-available');
  });
  it('leaves the latest (or a newer test build) alone', () => {
    expect(shellStatus(5, shell)).toBe('current');
    expect(shellStatus(6, shell)).toBe('current');
  });
});

describe('safeAppPath', () => {
  it('follows paths inside the app only', () => {
    expect(safeAppPath('/orders/abc')).toBe('/orders/abc');
    expect(safeAppPath('//evil.example.com/x')).toBe('/');
    expect(safeAppPath('https://evil.example.com')).toBe('/');
    expect(safeAppPath(undefined)).toBe('/');
    expect(safeAppPath(42)).toBe('/');
  });
});
