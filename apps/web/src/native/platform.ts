/**
 * The native Android app loads this same web app in a WebView and injects `window.Capacitor`.
 * Checking for it here (instead of importing @capacitor/core) keeps the browser bundle unchanged;
 * plugin code is only loaded, with import(), inside the app.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Running inside the installed Android app (not a browser or the Home Screen web app). */
export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

export function nativePlatform(): 'android' | 'ios' | null {
  if (!isNative()) return null;
  const p = capacitor()?.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : null;
}

/** Only paths inside this app are followed (a notification can't send the app elsewhere). */
export function safeAppPath(url: unknown): string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}
