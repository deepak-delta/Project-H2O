import { useToasts } from '../stores/toast';
import { safeAppPath } from './platform';

/**
 * Native-app behaviour, started once inside the Android app (never loaded in a browser):
 * hardware back button, notification taps, and a short vibration on success/failure so the
 * result is felt without looking. Notifications arriving while the app is open are shown by
 * Android itself (presentationOptions in capacitor.config.ts).
 */
export async function startNative(navigate: (path: string) => void): Promise<void> {
  const [{ App }, { PushNotifications }, { SplashScreen }, { Haptics, ImpactStyle, NotificationType }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/push-notifications'),
    import('@capacitor/splash-screen'),
    import('@capacitor/haptics'),
  ]);

  // Back goes back through the app's screens; at the first screen the app goes to the background.
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });

  // Tapped notification (also the one that cold-started the app): open its screen.
  void PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    navigate(safeAppPath((notification.data as { url?: unknown } | undefined)?.url));
  });

  useToasts.subscribe((state, prev) => {
    const added = state.toasts.at(-1);
    if (!added || added === prev.toasts.at(-1)) return;
    if (added.tone === 'success') void Haptics.impact({ style: ImpactStyle.Light });
    if (added.tone === 'error') void Haptics.notification({ type: NotificationType.Error });
  });

  await SplashScreen.hide();
}

/** Opens a link outside the app (e.g. the new APK download, which the WebView can't save). */
export async function openExternal(url: string): Promise<void> {
  const { AppLauncher } = await import('@capacitor/app-launcher');
  await AppLauncher.openUrl({ url: new URL(url, window.location.origin).href });
}
