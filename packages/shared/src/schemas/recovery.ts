import { z } from 'zod';
import { phoneSchema, pinSchema } from './common';

/** A 6-digit code from an authenticator app (spaces allowed while typing). */
export const totpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'));

/** A recovery or support code, e.g. "7KQ2M-XW9PD" (case, spaces and dashes ignored). */
export const recoveryCodeSchema = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[^0-9A-Z]/g, ''))
  .pipe(z.string().regex(/^[0-9A-Z]{10}$/, 'Enter the 10-character code, e.g. 7KQ2M-XW9PD'));

// ─── Setting up recovery (signed in) ─────────────────────────────────────────

/** Starting (or replacing) setup. Replacing an active authenticator also needs a code from it. */
export const recoverySetupSchema = z.object({
  currentPin: pinSchema,
  code: totpCodeSchema.optional(),
});

export const recoveryVerifySchema = z.object({ code: totpCodeSchema });

/** New recovery codes, or turning recovery off: current PIN plus an authenticator code. */
export const recoveryConfirmSchema = z.object({
  currentPin: pinSchema,
  code: totpCodeSchema,
});

export interface RecoveryStatus {
  /** The server has an encryption key configured; without it recovery can't be set up. */
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

/** Shown once while setting up; the secret is never sent again after setup is verified. */
export interface RecoverySetupInfo {
  issuer: string;
  accountName: string;
  /** Grouped for typing, e.g. "JBSW Y3DP EHPK 3PXP …". */
  secret: string;
  /** otpauth://totp/… — opens the authenticator app directly on the same phone. */
  otpauthUri: string;
  /** SVG data URL of the same URI, for scanning from another phone. */
  qrDataUrl: string;
  type: 'Time-based';
  digits: 6;
  periodSeconds: 30;
  expiresAt: string;
}

export interface RecoveryCodesResult {
  recoveryCodes: string[];
}

// ─── Forgot PIN (signed out) ─────────────────────────────────────────────────

export const pinResetStartSchema = z.object({ phone: phoneSchema });

export const PIN_RESET_METHODS = ['TOTP', 'RECOVERY', 'ASSISTED'] as const;
export type PinResetMethod = (typeof PIN_RESET_METHODS)[number];

export const pinResetVerifySchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('TOTP'), code: totpCodeSchema }),
  z.object({ method: z.literal('RECOVERY'), code: recoveryCodeSchema }),
  z.object({ method: z.literal('ASSISTED'), code: recoveryCodeSchema }),
]);
export type PinResetVerifyInput = z.input<typeof pinResetVerifySchema>;

export const pinResetCompleteSchema = z
  .object({ pin: pinSchema, confirmPin: pinSchema })
  .refine((v) => v.pin === v.confirmPin, { message: 'The two PINs are different', path: ['confirmPin'] });
export type PinResetCompleteInput = z.input<typeof pinResetCompleteSchema>;
