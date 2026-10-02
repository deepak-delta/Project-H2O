import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Shown in the biometric prompt ("Sign in to Water Delivery"). */
  RP_NAME: z.string().default('Water Delivery'),
  /**
   * Secret mixed into every PIN hash so a leaked database alone cannot be brute-forced.
   * Required in production; a fixed value is acceptable for local development and tests.
   */
  PIN_PEPPER: z.string().min(16).default('dev-only-pepper-change-me'),
  /**
   * General per-IP request cap. On Vercel each instance counts separately, so this blunts
   * floods and scripted abuse; PIN guessing has its own database-backed limits.
   */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
  /**
   * Web Push (VAPID) keys. Generate once with `npx web-push generate-vapid-keys`.
   * Without them, notifications are simply switched off.
   */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  /** Contact for push services, e.g. mailto:owner@example.com */
  VAPID_SUBJECT: z.string().default('mailto:support@example.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = envSchema.parse(source);
  if (env.NODE_ENV === 'production' && env.PIN_PEPPER === 'dev-only-pepper-change-me') {
    throw new Error('PIN_PEPPER must be set to a strong secret in production');
  }
  return env;
}
