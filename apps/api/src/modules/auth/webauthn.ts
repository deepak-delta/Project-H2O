import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Db } from '../../lib/db';
import { unauthenticated, validationError } from '../../lib/errors';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The relying party is derived from the (already same-origin-checked) request origin, so the
 * same build works on localhost, Vercel previews and the production domain.
 */
export interface RelyingParty {
  origin: string;
  rpID: string;
  rpName: string;
}

function challengeFromClientData(clientDataJSON: string): string {
  try {
    const json = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as {
      challenge?: unknown;
    };
    if (typeof json.challenge === 'string') return json.challenge;
  } catch {
    // fall through
  }
  throw validationError('Biometric response was not readable. Please try again.');
}

/** Challenges are single use: fetched and deleted in one statement. */
async function consumeChallenge(
  db: Db,
  challenge: string,
  purpose: 'REGISTER' | 'LOGIN',
  userId: string | null,
): Promise<void> {
  // delete() returns the row and fails if it is already gone, so concurrent replays lose.
  const row = await db.authChallenge.delete({ where: { challenge } }).catch(() => null);
  if (
    !row ||
    row.purpose !== purpose ||
    row.expiresAt.getTime() < Date.now() ||
    (userId !== null && row.userId !== userId)
  ) {
    throw validationError('Biometric request expired. Please try again.');
  }
}

export async function startRegistration(db: Db, rp: RelyingParty, userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { credentials: { select: { credentialId: true, transports: true } } },
  });
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.phone,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: user.credentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  await db.authChallenge.create({
    data: {
      challenge: options.challenge,
      userId,
      purpose: 'REGISTER',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return options;
}

export async function finishRegistration(
  db: Db,
  rp: RelyingParty,
  userId: string,
  response: RegistrationResponseJSON,
  deviceName: string,
) {
  const challenge = challengeFromClientData(response.response.clientDataJSON);
  await consumeChallenge(db, challenge, 'REGISTER', userId);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  }).catch(() => null);

  if (!verification?.verified) {
    throw validationError("Couldn't set up biometric login on this device. Please try again.");
  }
  const { credential } = verification.registrationInfo;
  return db.webAuthnCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      deviceName,
    },
  });
}

export async function startLogin(db: Db, rp: RelyingParty) {
  // Discoverable credentials: the device offers the right passkey, no phone number needed.
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
  });
  await db.authChallenge.create({
    data: {
      challenge: options.challenge,
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return options;
}

/** Returns the userId the passkey belongs to. */
export async function finishLogin(
  db: Db,
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
): Promise<string> {
  const challenge = challengeFromClientData(response.response.clientDataJSON);
  await consumeChallenge(db, challenge, 'LOGIN', null);

  const stored = await db.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
    include: { user: { select: { active: true } } },
  });
  if (!stored || !stored.user.active) {
    throw unauthenticated('This device is no longer linked. Please log in with your PIN.');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(stored.publicKey),
      counter: Number(stored.counter),
      transports: stored.transports,
    },
  }).catch(() => null);

  if (!verification?.verified) {
    throw unauthenticated('Biometric login failed. Please log in with your PIN.');
  }

  await db.webAuthnCredential.update({
    where: { id: stored.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  return stored.userId;
}
