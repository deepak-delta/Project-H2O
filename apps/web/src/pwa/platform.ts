import { isNative } from '../native/platform';

/** iPhone / iPad (iPadOS reports itself as a Mac, so check for touch too). */
export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Running from the Home Screen / as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  if (isNative()) return true;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Opened inside another app's built-in browser (WhatsApp, Instagram, Gmail…) on iPhone.
 * Those can't add to the Home Screen; the page has to be opened in Safari first.
 * Their user agents leave out the "Safari/" token that Safari, Chrome and Firefox for iOS all send.
 */
export function isIosInAppBrowser(): boolean {
  return isIos() && !/Safari\//.test(navigator.userAgent);
}

/** Phones and tablets — where an installed app is worth asking about. */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
