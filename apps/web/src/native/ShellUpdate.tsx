import { Download, Droplets } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { openExternal } from './bootstrap';
import { ANDROID_SHELL, installedBuild, shellStatus, type ShellStatus } from './shell';

/**
 * Inside the Android app: asks for the new APK when the installed app is too old for the
 * screens it is now running (blocking), or when a newer one exists (a dismissible strip).
 */
export default function ShellUpdate() {
  const [status, setStatus] = useState<ShellStatus>('current');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    installedBuild()
      .then((build) => {
        if (build !== null) setStatus(shellStatus(build));
      })
      .catch(() => undefined);
  }, []);

  const download = () => void openExternal(ANDROID_SHELL.downloadUrl);

  if (status === 'update-required') {
    return (
      <div role="alertdialog" aria-modal="true" aria-labelledby="shell-update-title" className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-canvas px-6 pt-safe pb-safe text-center">
        <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-700 text-white">
          <Droplets className="size-8" aria-hidden />
        </span>
        <div className="max-w-sm">
          <h1 id="shell-update-title" className="text-xl font-semibold text-ink">
            Update the app
          </h1>
          <p className="mt-2 text-[15px] text-ink-2">
            This version of Water Delivery is too old. Download the new one and tap <strong>Install</strong> when your phone asks.
            Your data is safe.
          </p>
        </div>
        <Button size="lg" block className="max-w-sm" icon={<Download className="size-5" />} onClick={download}>
          Download update
        </Button>
      </div>
    );
  }

  if (status === 'update-available' && !dismissed) {
    return (
      <div className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div role="status" className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-2 text-white shadow-lg">
          <Download className="size-5 shrink-0" aria-hidden />
          <p className="flex-1 text-sm">A new version of the app is available.</p>
          <button type="button" onClick={() => setDismissed(true)} className="h-10 px-2 text-sm text-white/70">
            Later
          </button>
          <button type="button" onClick={download} className="h-10 rounded-xl bg-white px-3 text-sm font-semibold text-ink">
            Get it
          </button>
        </div>
      </div>
    );
  }

  return null;
}
