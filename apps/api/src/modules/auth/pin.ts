import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;
const COST = { N: 16384, r: 8, p: 1 } as const;

function scryptAsync(secret: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, COST, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** HMAC with a server secret first, so a leaked DB alone is not enough to brute-force 6 digits. */
function peppered(pin: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(pin).digest();
}

export async function hashPin(pin: string, pepper: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(peppered(pin, pepper), salt);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string, pepper: string): Promise<boolean> {
  const [scheme, , , , saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(peppered(pin, pepper), Buffer.from(saltB64, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A real hash of a random PIN, used to keep timing identical when the phone is unknown. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(pepper: string): Promise<string> {
  dummyHash ??= hashPin(randomBytes(4).toString('hex'), pepper);
  return dummyHash;
}
