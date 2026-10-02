import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { MeResponse, PasskeySummary } from '@wd/shared';
import { api, ApiError } from '../../services/api';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';

/** True when this phone can do Face ID / Touch ID / fingerprint for the web app. */
export async function canUseBiometrics(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export function isBiometricEnrolledHere(): boolean {
  return deviceStorage.get(DEVICE_KEYS.biometricEnrolled) === '1';
}

/** Best-effort human name for the device list, e.g. "iPhone" or "Android phone". */
function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

/** The user cancelling the system prompt is not an error worth shouting about. */
export function isUserCancel(err: unknown): boolean {
  return (
    (err instanceof WebAuthnError && err.code === 'ERROR_CEREMONY_ABORTED') ||
    (err instanceof Error && err.name === 'NotAllowedError')
  );
}

export async function enrollBiometrics(): Promise<PasskeySummary> {
  const optionsJSON = await api.post<PublicKeyCredentialCreationOptionsJSON>(
    '/auth/passkeys/register/options',
  );
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (err) {
    if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      deviceStorage.set(DEVICE_KEYS.biometricEnrolled, '1');
      throw new ApiError(409, 'CONFLICT', 'Biometric login is already set up on this device.');
    }
    throw err;
  }
  const passkey = await api.post<PasskeySummary>('/auth/passkeys/register/verify', {
    response,
    deviceName: guessDeviceName(),
  });
  deviceStorage.set(DEVICE_KEYS.biometricEnrolled, '1');
  return passkey;
}

export async function loginWithBiometrics(): Promise<MeResponse> {
  const optionsJSON = await api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkeys/login/options');
  const response = await startAuthentication({ optionsJSON });
  try {
    return await api.post<MeResponse>('/auth/passkeys/login/verify', { response });
  } catch (err) {
    // The passkey was removed on the server; stop offering it on this device.
    if (err instanceof ApiError && err.status === 401) deviceStorage.remove(DEVICE_KEYS.biometricEnrolled);
    throw err;
  }
}
