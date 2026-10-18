import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app is a native shell around the live web app: it opens APP_URL, so every web
 * deploy reaches phones straight away (the in-app "new version" prompt handles the swap).
 * Set APP_URL to a LAN dev server (e.g. http://192.168.1.20:5173) for a debug build.
 */
const appUrl = new URL(process.env.APP_URL ?? 'https://project-h2-o-ten.vercel.app');

const config: CapacitorConfig = {
  appId: 'com.delta.projecth2o',
  appName: 'Water Delivery',
  // Shown only when the very first launch has no internet; afterwards the app opens offline.
  webDir: 'www',
  server: {
    url: appUrl.href,
    // Links to any other site open in the phone's browser, never inside the app.
    allowNavigation: [appUrl.host],
    cleartext: appUrl.protocol === 'http:',
    errorPath: 'index.html',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // The web app hides the splash as soon as it has drawn (native/bootstrap.ts). The timeout
    // is the safety net: a slow network or an older web build must never leave it stuck.
    SplashScreen: { launchAutoHide: true, launchShowDuration: 4000, backgroundColor: '#f6f7f9', showSpinner: false },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    // The app is light and draws under the status bar (viewport-fit=cover), using safe-area insets.
    SystemBars: { style: 'LIGHT', initialViewportFitValueHint: 'cover' },
  },
};

export default config;
