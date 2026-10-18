/**
 * Versions of the native Android app (its "shell"). The screens themselves come from the web
 * and update with every deploy; the shell only needs replacing when native code changes.
 *
 * Raise LATEST when a new APK is uploaded (users see a gentle reminder), and MIN when older
 * apps must not be used any more (they see a blocking "Update the app" screen).
 * Numbers are the Android versionCode (apps/mobile/android/app/build.gradle).
 */
export const ANDROID_SHELL = {
  min: 1,
  latest: 1,
  downloadUrl: '/download/water-delivery.apk',
} as const;

export type ShellStatus = 'current' | 'update-available' | 'update-required';

export function shellStatus(build: number, shell: { min: number; latest: number } = ANDROID_SHELL): ShellStatus {
  if (!Number.isFinite(build) || build < shell.min) return 'update-required';
  return build < shell.latest ? 'update-available' : 'current';
}

/** The installed app's versionCode, or null outside the app. */
export async function installedBuild(): Promise<number | null> {
  const { App } = await import('@capacitor/app');
  const info = await App.getInfo();
  return Number.parseInt(info.build, 10);
}
