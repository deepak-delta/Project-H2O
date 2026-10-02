/**
 * Tiny localStorage wrapper for per-device conveniences only (never business data).
 * Storage can be unavailable (private mode, blocked site data), so every access is guarded.
 */
const PREFIX = 'wd.';

export const deviceStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(PREFIX + key, value);
    } catch {
      // ignore
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // ignore
    }
  },
};

export const DEVICE_KEYS = {
  /** Set once Face ID / fingerprint has been enrolled on this device. */
  biometricEnrolled: 'biometricEnrolled',
  biometricPromptDismissed: 'biometricPromptDismissed',
  lastPhone: 'lastPhone',
} as const;
