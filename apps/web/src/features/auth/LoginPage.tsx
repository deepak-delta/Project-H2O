import { zodResolver } from '@hookform/resolvers/zod';
import { formatPhone, pinLoginSchema, type PinLoginInput } from '@wd/shared';
import { ScanFace } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { PinField } from '../../components/ui/PinField';
import { ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';
import { AuthLayout } from './AuthLayout';
import { biometricLabel } from './biometricLabel';
import { canUseBiometrics, isBiometricEnrolledHere, isUserCancel } from './passkeys';
import { useBiometricLogin, usePinLogin } from './session';

type FormInput = z.input<typeof pinLoginSchema>;
type FormOutput = z.output<typeof pinLoginSchema>;

export default function LoginPage() {
  const pinLogin = usePinLogin();
  const bioLogin = useBiometricLogin();
  const [showBiometric, setShowBiometric] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(pinLoginSchema),
    defaultValues: { phone: deviceStorage.get(DEVICE_KEYS.lastPhone) ?? '', pin: '' },
  });

  useEffect(() => {
    if (!isBiometricEnrolledHere()) return;
    void canUseBiometrics().then(setShowBiometric);
  }, []);

  const onSubmit = handleSubmit((values: PinLoginInput) => {
    setFormError(null);
    pinLogin.mutate(values, {
      onSuccess: () => deviceStorage.set(DEVICE_KEYS.lastPhone, formatPhone(values.phone)),
      onError: (err) => {
        setValue('pin', '');
        setFormError(errorMessage(err));
      },
    });
  });

  const onBiometric = () => {
    setFormError(null);
    bioLogin.mutate(undefined, {
      onError: (err) => {
        if (isUserCancel(err)) return;
        if (err instanceof ApiError && err.status === 401) setShowBiometric(false);
        toast.error(err instanceof ApiError ? err.message : `${biometricLabel()} didn't work. Use your PIN.`);
      },
    });
  };

  return (
    <AuthLayout title="Log in" subtitle="Welcome back.">
      {showBiometric ? (
        <>
          <Button size="lg" block onClick={onBiometric} loading={bioLogin.isPending} icon={<ScanFace className="size-5" />}>
            Log in with {biometricLabel()}
          </Button>
          <div className="my-6 flex items-center gap-3 text-sm text-muted">
            <span className="h-px flex-1 bg-line" />
            or use your PIN
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          placeholder="98765 43210"
          prefix="+91"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Controller
          control={control}
          name="pin"
          render={({ field }) => (
            <PinField
              label="6-digit PIN"
              value={field.value}
              onChange={field.onChange}
              error={errors.pin?.message}
              onComplete={() => void onSubmit()}
            />
          )}
        />
        {formError ? (
          <p role="alert" className="rounded-xl bg-bad-bg px-3.5 py-3 text-sm text-bad">
            {formError}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={pinLogin.isPending}>
          Log in
        </Button>
        <Link to="/forgot-pin" className="-mt-1 flex h-11 items-center justify-center text-[15px] font-semibold text-brand-700">
          Forgot PIN?
        </Link>
      </form>

      <div className="mt-auto space-y-3 pt-10 text-center text-sm text-muted">
        <p>
          New water business?{' '}
          <Link to="/signup" className="font-semibold text-brand-700">
            Create an account
          </Link>
        </p>
        <p>Clients: ask your water supplier for your login.</p>
      </div>
    </AuthLayout>
  );
}
