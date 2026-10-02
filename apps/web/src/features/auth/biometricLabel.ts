/** What the platform calls its biometric unlock, for button labels. */
export function biometricLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Face ID';
  if (/Android/.test(ua)) return 'fingerprint';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  return 'fingerprint or face';
}
