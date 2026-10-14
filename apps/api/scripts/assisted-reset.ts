/**
 * Admin-assisted PIN reset, for someone who lost BOTH their authenticator app and their
 * recovery codes. Staff and clients don't need this: their business owner can set a new PIN
 * for them in the app (Delivery staff → person, or the client's page → Client app).
 *
 * Use it only after verifying the person's identity out of band, for example:
 *   1. Call them back on the phone number registered to the account (never a number they give you).
 *   2. Ask for details only the owner knows: business name, a recent client, a recent payment amount.
 *   3. If anything doesn't match, stop.
 *
 * It prints a one-time support code valid for 30 minutes. Read it to them on that call. They
 * enter it at Login → Forgot PIN? → "I have a code from support", then choose a new PIN. The
 * code is stored only as a keyed hash, and issuing and using it are written to the audit trail.
 *
 * Run with the production environment (DATABASE_URL and the same PIN_PEPPER as the app):
 *   npm run admin:assisted-reset -w @wd/api -- --phone 9846012345 --operator "Deepak" \
 *     --evidence "Called back registered number; confirmed business name and last payment"
 */
import { normalizePhone } from '@wd/shared';
import { parseArgs } from 'node:util';
import { loadEnv } from '../src/env';
import { createDb } from '../src/lib/db';
import { recordAuthEvent } from '../src/modules/auth/auth-events';
import { formatRecoveryCode, newRecoveryCode, recoveryCodeHash } from '../src/modules/auth/recovery-codes';

const VALID_MINUTES = 30;

const { values } = parseArgs({
  options: { phone: { type: 'string' }, operator: { type: 'string' }, evidence: { type: 'string' } },
});
const phone = normalizePhone(values.phone ?? '');
const operator = values.operator?.trim() ?? '';
const evidence = values.evidence?.trim() ?? '';
if (!phone || operator.length < 2 || evidence.length < 15) {
  console.error('Usage: --phone <registered number> --operator "<your name>" --evidence "<how you verified their identity>"');
  console.error('Evidence must describe the identity check (at least 15 characters).');
  process.exit(1);
}

const env = loadEnv();
const db = createDb(env.DATABASE_URL, { maxConnections: 1 });
try {
  const user = await db.user.findUnique({ where: { phone }, select: { id: true, name: true, role: true, active: true } });
  if (!user?.active) {
    console.error('No active account has that phone number.');
    process.exit(1);
  }
  const code = newRecoveryCode();
  const expiresAt = new Date(Date.now() + VALID_MINUTES * 60 * 1000);
  await db.$transaction(async (tx) => {
    // Only the newest support code works.
    await tx.assistedResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.assistedResetCode.create({
      data: { userId: user.id, codeHash: recoveryCodeHash(code, user.id, env.PIN_PEPPER), issuedBy: operator, evidence, expiresAt },
    });
    await recordAuthEvent(tx, { type: 'ASSISTED_CODE_ISSUED', userId: user.id, method: 'ASSISTED', detail: { issuedBy: operator, evidence } });
  });
  console.log(`Support code for ${user.name} (${user.role.toLowerCase()}): ${formatRecoveryCode(code)}`);
  console.log(`Valid until ${expiresAt.toISOString()} (${VALID_MINUTES} minutes), once. Read it to them on the verified call.`);
} finally {
  await db.$disconnect();
}
