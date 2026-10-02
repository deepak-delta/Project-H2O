import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePinSchema, type PasskeySummary } from '@wd/shared';
import { ScanFace, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { PinField } from '../../components/ui/PinField';
import { ConfirmSheet } from '../../components/ui/Sheet';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { api, ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { formatDate } from '../../utils/format';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';
import { biometricLabel } from '../auth/biometricLabel';
import { canUseBiometrics, enrollBiometrics, isBiometricEnrolledHere, isUserCancel } from '../auth/passkeys';
import { meQueryKey } from '../auth/session';

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

export default function SecurityPage() {
  return (
    <>
      <PageHeader title="Login & security" back={true} />
      <PageBody>
        <BiometricSection />
        <ChangePinSection />
      </PageBody>
    </>
  );
}
