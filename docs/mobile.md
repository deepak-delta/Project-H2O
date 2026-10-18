# Android app

The Android app (`apps/mobile`) is a native shell around the live web app. It opens
`https://project-h2-o-ten.vercel.app` in a WebView and adds:

- native push notifications through Firebase Cloud Messaging
- fingerprint and face login (passkeys)
- the hardware back button
- a short vibration on success or error

iPhones keep using the web app added to the Home Screen. It gets web push on iOS 16.4+. A
native iPhone app would need a paid Apple Developer account, because free sideloaded apps
expire every 7 days and can't receive push.

## How updates reach phones

| What changed | What to do | What users see |
| --- | --- | --- |
| Screens, logic, styles (almost everything) | Deploy to Vercel as usual | "A new version is ready", then **Update** |
| Native code: plugins, `MainActivity`, icons, `capacitor.config.ts` | Build a new APK, upload it, raise the version numbers below | An "update the app" strip, or a blocking screen |

The native versions live in `apps/web/src/native/shell.ts`:

- `latest`: the newest APK's `versionCode`. Older apps show a dismissible "new version" strip.
- `min`: apps older than this see a blocking **Update the app** screen. Raise it only when old
  apps would actually break.
- `downloadUrl`: where the APK is downloaded from.

When you build a new APK, raise `versionCode` (and `versionName`) in
`apps/mobile/android/app/build.gradle` first.

## One-time setup

### 1. Android SDK

On this Mac the command-line SDK is installed with Homebrew. That is enough to build; Android
Studio is optional.

```bash
brew install --cask android-commandlinetools
sdkmanager --install "platforms;android-36" "build-tools;36.0.0"
echo 'export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools' >> ~/.zshrc
```

To test on a phone, turn on **Developer options → USB debugging**, plug it in and allow the
prompt. `adb devices` should list it.

### 2. Firebase (free), for push

1. At <https://console.firebase.google.com>, create a project and add an **Android app** with
   package name `com.h2o.waterdelivery`.
2. Download `google-services.json` into `apps/mobile/android/app/`. It is gitignored.
3. Go to **Project settings → Service accounts → Generate new private key**. Base64-encode the
   downloaded file:

   ```bash
   base64 -i ~/Downloads/your-key.json | pbcopy
   ```

   Then paste it into Vercel as the environment variable `FCM_SERVICE_ACCOUNT_JSON` (Production)
   and redeploy. Never commit the key.

Without `FCM_SERVICE_ACCOUNT_JSON` the app still works; its Notifications screen says "Not
available yet".

### 3. Signing key (keeps updates installable)

Android only installs an update when it is signed with the same key as the installed app.
Create the key once, keep it **outside the repo**, and back it up. If it is lost, everyone has
to uninstall and reinstall.

```bash
keytool -genkeypair -v -keystore ~/keys/water-delivery.jks -alias water -keyalg RSA -keysize 2048 -validity 10000
```

Then create `apps/mobile/android/keystore.properties`. It is gitignored. Write it in your own
editor, not in chat:

```
storeFile=/Users/<you>/keys/water-delivery.jks
storePassword=…
keyAlias=water
keyPassword=…
```

### 4. Fingerprint login inside the app

Passkeys work in the app once the website vouches for it. Get the key's SHA-256 fingerprint:

```bash
keytool -list -v -keystore ~/keys/water-delivery.jks -alias water
```

Create `apps/web/public/.well-known/assetlinks.json` with that fingerprint and deploy:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.h2o.waterdelivery",
      "sha256_cert_fingerprints": ["AA:BB:…"]
    }
  }
]
```

If a phone's WebView can't do passkeys, the app hides the fingerprint option and uses the PIN.

## Build and share the APK

```bash
npm run mobile:apk
```

The APK is written to `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. Copy it
to `apps/web/public/download/water-delivery.apk` and deploy, or upload it anywhere and point
`downloadUrl` there. Then share the link.

On each phone:

1. Open the link and download.
2. Allow **Install unknown apps** for the browser when Android asks (once).
3. Install, open, log in, then go to **More → Notifications → Turn on**.

## Development

To try web changes in the app before deploying, run them on a USB phone against your Mac.

1. Start the local server with the local test database: the `dev-localdb` launch config.
2. Build a debug APK that points at your Mac:

   ```bash
   APP_URL=http://localhost:5173 npm run apk:debug -w @wd/mobile
   ```

3. Route the phone's localhost to your Mac, then install the APK:

   ```bash
   adb reverse tcp:5173 tcp:5173
   ```

   ```bash
   adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
   ```

Afterwards, rebuild without `APP_URL` so the app points at the live site again.
