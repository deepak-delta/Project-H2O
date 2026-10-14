import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePinSchema, type PasskeySummary, type RecoveryCodesResult } from '@wd/shared';
import { KeyRound, ScanFace, ShieldCheck, Smartphone } from 'lucide-react';
import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { PinField } from '../../components/ui/PinField';
import { ConfirmSheet, Sheet } from '../../components/ui/Sheet';
import { Field } from '../../components/ui/Field';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { api, ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { formatDate } from '../../utils/format';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';
import { biometricLabel } from '../auth/biometricLabel';
import { canUseBiometrics, enrollBiometrics, isBiometricEnrolledHere, isUserCancel } from '../auth/passkeys';
import { meQueryKey } from '../auth/session';
import { digitsOnly, recoveryStatusKey, useRecoveryStatus } from './recovery';
import { RecoveryCodesView } from './RecoveryCodesView';

const passkeysKey = ['passkeys'] as const;

function BiometricSection() {
  const queryClient = useQueryClient();
  const label = biometricLabel();
  const [supported, setSupported] = useState(false);
  const [removing, setRemoving] = useState<PasskeySummary | null>(null);
  const passkeys = useQuery({ queryKey: passkeysKey, queryFn: () => api.get<PasskeySummary[]>('/auth/passkeys') });

  useEffect(() => {
    void canUseBiometrics().then(setSupported);
  }, []);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: passkeysKey });
    void queryClient.invalidateQueries({ queryKey: meQueryKey });
  };

  const enroll = useMutation({
    mutationFn: enrollBiometrics,
    onSuccess: () => {
      refresh();
      toast.success(`${label} login is on for this device.`);
    },
    onError: (err) => {
      if (!isUserCancel(err)) toast.error(errorMessage(err, `Couldn't turn on ${label}.`));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/passkeys/${id}`),
    onSuccess: () => {
      // We can't tell which passkey belongs to this browser, so ask it to offer again.
      deviceStorage.remove(DEVICE_KEYS.biometricEnrolled);
      setRemoving(null);
      refresh();
      toast.success('Device removed.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <section>
      <SectionTitle>Face ID / fingerprint</SectionTitle>
      {passkeys.isPending ? (
        <ListSkeleton rows={1} />
      ) : passkeys.data && passkeys.data.length > 0 ? (
        <ListCard>
          {passkeys.data.map((p) => (
            <ListRow
              key={p.id}
              leading={<Smartphone className="size-5 text-muted" aria-hidden />}
              title={p.deviceName}
              subtitle={`Added ${formatDate(p.createdAt)}${p.lastUsedAt ? ` · last used ${formatDate(p.lastUsedAt)}` : ''}`}
              trailing={
                <button
                  type="button"
                  onClick={() => setRemoving(p)}
                  className="h-11 rounded-lg px-2 text-sm font-semibold text-bad"
                >
                  Remove
                </button>
              }
            />
          ))}
        </ListCard>
      ) : (
        <Card className="px-4 py-3.5 text-sm text-muted">No devices yet. Log in with your PIN only.</Card>
      )}

      {supported && !isBiometricEnrolledHere() ? (
        <Button
          variant="secondary"
          block
          className="mt-3"
          icon={<ScanFace className="size-5" />}
          loading={enroll.isPending}
          onClick={() => enroll.mutate()}
        >
          Use {label} on this device
        </Button>
      ) : null}

      <ConfirmSheet
        open={removing !== null}
        title="Remove this device?"
        message={`${removing?.deviceName ?? 'This device'} will need your PIN to log in.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

type PinFormInput = z.input<typeof changePinSchema>;

function ChangePinSection() {
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PinFormInput>({
    resolver: zodResolver(changePinSchema),
    defaultValues: { currentPin: '', newPin: '' },
  });

  const change = useMutation({
    mutationFn: (values: PinFormInput) => api.post<void>('/auth/pin', values),
    onSuccess: () => {
      reset();
      toast.success('PIN changed. Other devices were logged out.');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields?.currentPin) {
        setError('currentPin', { message: err.fields.currentPin });
      } else {
        toast.error(errorMessage(err));
      }
    },
  });

  return (
    <section>
      <SectionTitle>Change PIN</SectionTitle>
      <Card className="p-4">
        <form onSubmit={handleSubmit((v) => change.mutate(v))} noValidate className="flex flex-col gap-4">
          <Controller
            control={control}
            name="currentPin"
            render={({ field }) => (
              <PinField label="Current PIN" value={field.value} onChange={field.onChange} error={errors.currentPin?.message} />
            )}
          />
          <Controller
            control={control}
            name="newPin"
            render={({ field }) => (
              <PinField
                label="New PIN"
                autoComplete="new-password"
                value={field.value}
                onChange={field.onChange}
                error={errors.newPin?.message}
              />
            )}
          />
          <Button type="submit" block loading={change.isPending}>
            Change PIN
          </Button>
        </form>
      </Card>
    </section>
  );
}

/** PIN recovery with an authenticator app: status, and the actions that need PIN + code. */
function PinRecoverySection() {
  const status = useRecoveryStatus();
  const [sheet, setSheet] = useState<'codes' | 'disable' | null>(null);
  const data = status.data;

  return (
    <section>
      <SectionTitle>PIN recovery</SectionTitle>
      {status.isPending ? (
        <ListSkeleton rows={1} />
      ) : !data?.available ? (
        <Card className="px-4 py-3.5 text-sm text-muted">PIN recovery isn't available yet.</Card>
      ) : !data.enabled ? (
        <Card className="flex flex-col gap-3 p-4">
          <p className="flex gap-3 text-[15px] text-ink-2">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            Forgot your PIN one day? With an authenticator app (Google Authenticator, Microsoft Authenticator or Authy) you can reset it
            yourself. No SMS, no cost.
          </p>
          <Link to="/settings/recovery" className="flex h-11 items-center justify-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
            Set up PIN recovery
          </Link>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 p-4">
          <p className="flex items-start gap-3 text-[15px]">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
            <span>
              <span className="font-semibold text-ink">On</span>
              {data.enabledAt ? <span className="text-muted"> · since {formatDate(data.enabledAt)}</span> : null}
              <span className={`block text-sm ${data.recoveryCodesLeft <= 3 ? 'font-semibold text-warn' : 'text-muted'}`}>
                {data.recoveryCodesLeft} recovery code{data.recoveryCodesLeft === 1 ? '' : 's'} left
                {data.recoveryCodesLeft <= 3 ? ': make new ones soon' : ''}
              </span>
            </span>
          </p>
          <Button variant="secondary" block onClick={() => setSheet('codes')}>
            New recovery codes
          </Button>
          <Link to="/settings/recovery" className="flex h-11 items-center justify-center rounded-xl border border-line-strong bg-surface px-3 text-[15px] font-semibold text-ink">
            Replace authenticator app
          </Link>
          <Button variant="dangerGhost" onClick={() => setSheet('disable')}>
            Turn off PIN recovery
          </Button>
        </Card>
      )}
      <PinAndCodeSheet mode={sheet} onClose={() => setSheet(null)} />
    </section>
  );
}

/** Current PIN + an authenticator code, then either show new recovery codes or turn it off. */
function PinAndCodeSheet({ mode, onClose }: { mode: 'codes' | 'disable' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ currentPin?: string; code?: string; form?: string }>({});
  const [codes, setCodes] = useState<string[] | null>(null);

  const close = () => {
    setPin('');
    setCode('');
    setErrors({});
    setCodes(null);
    onClose();
  };

  const run = useMutation({
    mutationFn: async (): Promise<RecoveryCodesResult | null> => {
      if (mode === 'codes') return api.post<RecoveryCodesResult>('/auth/recovery/codes', { currentPin: pin, code });
      await api.post<void>('/auth/recovery/disable', { currentPin: pin, code });
      return null;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: recoveryStatusKey });
      if (result) {
        setCodes(result.recoveryCodes);
      } else {
        toast.success('PIN recovery is off.');
        close();
      }
    },
    onError: (err) => {
      setCode('');
      if (err instanceof ApiError && err.fields) setErrors({ currentPin: err.fields.currentPin, code: err.fields.code, form: err.fields.currentPin || err.fields.code ? undefined : err.message });
      else setErrors({ form: errorMessage(err) });
    },
  });

  const submit = () => {
    const next: typeof errors = {};
    if (!/^\d{6}$/.test(pin)) next.currentPin = 'Enter your 6-digit PIN';
    if (!/^\d{6}$/.test(code)) next.code = 'Enter the 6-digit code';
    setErrors(next);
    if (!next.currentPin && !next.code) run.mutate();
  };

  return (
    <Sheet open={mode !== null} onClose={close} title={codes ? 'Your new recovery codes' : mode === 'codes' ? 'New recovery codes' : 'Turn off PIN recovery?'}>
      {codes ? (
        <RecoveryCodesView codes={codes} onDone={close} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-muted">
            {mode === 'codes'
              ? 'Your old recovery codes will stop working.'
              : "You won't be able to reset a forgotten PIN yourself. Your recovery codes stop working too."}
          </p>
          <PinField label="Your current PIN" value={pin} onChange={setPin} error={errors.currentPin} revealable />
          <Field
            label="Code from your authenticator app"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(digitsOnly(e.target.value))}
            error={errors.code}
          />
          {errors.form ? (
            <p role="alert" className="rounded-xl bg-bad-bg px-3.5 py-3 text-sm text-bad">
              {errors.form}
            </p>
          ) : null}
          <Button size="lg" block variant={mode === 'disable' ? 'danger' : 'primary'} loading={run.isPending} onClick={submit}>
            {mode === 'codes' ? 'Make new codes' : 'Turn off'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export default function SecurityPage() {
  return (
    <>
      <PageHeader title="Login & security" back={true} />
      <PageBody>
        <BiometricSection />
        <ChangePinSection />
        <PinRecoverySection />
      </PageBody>
    </>
  );
}
