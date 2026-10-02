import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScanFace } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';
import { biometricLabel } from './biometricLabel';
import { canUseBiometrics, enrollBiometrics, isBiometricEnrolledHere, isUserCancel } from './passkeys';
import { meQueryKey } from './session';

/** After a PIN login, offer Face ID / fingerprint once per device. */
export function BiometricEnrollPrompt() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const label = biometricLabel();

  useEffect(() => {
    if (isBiometricEnrolledHere() || deviceStorage.get(DEVICE_KEYS.biometricPromptDismissed)) return;
    let cancelled = false;
    void canUseBiometrics().then((ok) => {
      if (ok && !cancelled) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enroll = useMutation({
    mutationFn: enrollBiometrics,
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
      toast.success(`${label} login is on for this device.`);
    },
    onError: (err) => {
      if (isUserCancel(err)) return;
      toast.error(errorMessage(err, `Couldn't turn on ${label}. You can try again in Settings.`));
    },
  });

  const dismiss = () => {
    deviceStorage.set(DEVICE_KEYS.biometricPromptDismissed, '1');
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={dismiss} title="Log in faster">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <ScanFace className="size-6" aria-hidden />
        </span>
        <p className="text-[15px] text-ink-2">
          Use {label} on this phone instead of typing your PIN. Your PIN still works as a backup.
        </p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" onClick={dismiss}>
          Not now
        </Button>
        <Button size="lg" loading={enroll.isPending} onClick={() => enroll.mutate()}>
          Turn on
        </Button>
      </div>
    </Sheet>
  );
}
