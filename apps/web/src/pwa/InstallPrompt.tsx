import { Droplets, Share, SquarePlus } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { getInstallEvent, promptInstall, subscribeInstallEvent } from './installEvent';
import { isInstalled, isIos, isIosInAppBrowser, isTouchDevice } from './platform';

const DISMISSED_KEY = 'wd-install-dismissed-at';
/** After "Not now", ask again a week later. */
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;
/** Let the page draw first so the sheet doesn't flash over a blank screen. */
const SHOW_DELAY_MS = 1200;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && Date.now() - at < ASK_AGAIN_MS;
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Private mode / storage blocked: it will simply ask again next visit.
  }
}

/**
 * Offers to install the app when it is opened in a phone browser.
 *  - Android (Chrome, Edge, Samsung): one tap opens the browser's own install dialog.
 *  - iPhone: Safari has no install API, so it shows the two Share-menu steps.
 */
export function InstallPrompt() {
  const installEvent = useSyncExternalStore(subscribeInstallEvent, getInstallEvent, () => null);
  const [eligible, setEligible] = useState(false);
  const [closed, setClosed] = useState(false);
  const ios = isIos();
  // iPhone can always be shown the steps; elsewhere wait until the browser says it can install.
  const open = eligible && !closed && (ios || installEvent !== null);

  useEffect(() => {
    if (isInstalled() || !isTouchDevice() || dismissedRecently()) return;
    const timer = window.setTimeout(() => setEligible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    rememberDismissed();
    setClosed(true);
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'dismissed') rememberDismissed();
    setClosed(true);
  };

  return (
    <Sheet open={open} onClose={close} title="Install the app">
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white">
          <Droplets className="size-6" aria-hidden />
        </span>
        <p className="text-[15px] text-ink-2">
          Open it from your Home Screen like any app: faster, full screen, works without internet
          {ios ? ', and can send you notifications' : ''}.
        </p>
      </div>

      {ios ? (
        isIosInAppBrowser() ? (
          <p className="mt-4 rounded-xl bg-warn-bg px-4 py-3 text-[15px] text-ink-2">
            First open this page in <strong className="font-semibold text-ink">Safari</strong>: tap the menu in this app and
            choose “Open in Safari”. Then add it to your Home Screen from there.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-2">
            <Step n={1} icon={<Share className="size-5" aria-hidden />}>
              Tap the <strong className="font-semibold text-ink">Share</strong> button in Safari’s toolbar
            </Step>
            <Step n={2} icon={<SquarePlus className="size-5" aria-hidden />}>
              Scroll down and choose <strong className="font-semibold text-ink">Add to Home Screen</strong>
            </Step>
            <Step n={3} icon={<Droplets className="size-5" aria-hidden />}>
              Open <strong className="font-semibold text-ink">Water</strong> from your Home Screen
            </Step>
          </ol>
        )
      ) : null}

      <div className="mt-5 flex flex-col gap-2">
        {!ios && installEvent ? (
          <Button size="lg" block onClick={() => void install()}>
            Install app
          </Button>
        ) : null}
        <Button variant={ios ? 'secondary' : 'ghost'} size="lg" block onClick={close}>
          {ios ? 'Got it' : 'Not now'}
        </Button>
      </div>
    </Sheet>
  );
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-canvas px-3 py-2.5 text-[15px] text-ink-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-semibold text-ink tabular">
        {n}
      </span>
      <span className="flex-1">{children}</span>
      <span className="shrink-0 text-brand-700">{icon}</span>
    </li>
  );
}
