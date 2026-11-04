import { zodResolver } from '@hookform/resolvers/zod';
import { formatPhone, signupSchema } from '@wd/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { LegalLinks } from '../legal/LegalLayout';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { PinField } from '../../components/ui/PinField';
import { ApiError, errorMessage } from '../../services/api';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';
import { AuthLayout } from './AuthLayout';
import { useSignup } from './session';

const formSchema = signupSchema
  .extend({ confirmPin: z.string() })
  .refine((v) => v.pin === v.confirmPin, { message: "PINs don't match", path: ['confirmPin'] });

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/** Two short steps: business details, then a PIN. */
export default function SignupPage() {
  const signup = useSignup();
  const [step, setStep] = useState<1 | 2>(1);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    trigger,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { businessName: '', ownerName: '', phone: '', pin: '', confirmPin: '' },
  });

  const next = async () => {
    if (await trigger(['businessName', 'ownerName', 'phone'])) setStep(2);
  };

  const onSubmit = handleSubmit(({ confirmPin: _confirm, ...values }) => {
    setFormError(null);
    signup.mutate(values, {
      onSuccess: () => deviceStorage.set(DEVICE_KEYS.lastPhone, formatPhone(values.phone)),
      onError: (err) => {
        if (err instanceof ApiError && err.fields) {
          for (const [field, message] of Object.entries(err.fields)) {
            if (field in formSchema.shape) setError(field as keyof FormInput, { message });
          }
          if (err.fields.phone || err.fields.businessName || err.fields.ownerName) setStep(1);
        }
        if (err instanceof ApiError && err.status === 409) setStep(1);
        setFormError(errorMessage(err));
      },
    });
  });

  return (
    <AuthLayout
      title={step === 1 ? 'Set up your business' : 'Create a PIN'}
      subtitle={step === 1 ? 'Step 1 of 2' : "Step 2 of 2 · You'll use it to log in."}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {step === 1 ? (
          <>
            <Field
              label="Business name"
              autoComplete="organization"
              placeholder="e.g. Aqua Fresh Water Supply"
              error={errors.businessName?.message}
              {...register('businessName')}
            />
            <Field label="Your name" autoComplete="name" error={errors.ownerName?.message} {...register('ownerName')} />
            <Field
              label="Phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="98765 43210"
              prefix="+91"
              hint="You'll log in with this number."
              error={errors.phone?.message}
              {...register('phone')}
            />
            {formError ? (
              <p role="alert" className="rounded-xl bg-bad-bg px-3.5 py-3 text-sm text-bad">
                {formError}
              </p>
            ) : null}
            <Button size="lg" block onClick={() => void next()}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Controller
              control={control}
              name="pin"
              render={({ field }) => (
                <PinField
                  label="New 6-digit PIN"
                  autoComplete="new-password"
                  autoFocus
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.pin?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="confirmPin"
              render={({ field }) => (
                <PinField
                  label="Enter the PIN again"
                  autoComplete="new-password"
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.confirmPin?.message}
                />
              )}
            />
            {formError ? (
              <p role="alert" className="rounded-xl bg-bad-bg px-3.5 py-3 text-sm text-bad">
                {formError}
              </p>
            ) : null}
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <Button variant="secondary" size="lg" onClick={() => setStep(1)} disabled={signup.isPending}>
                Back
              </Button>
              <Button type="submit" size="lg" loading={signup.isPending}>
                Create account
              </Button>
            </div>
            <p className="text-center text-sm text-muted">
              By creating an account you agree to the <LegalLinks />.
            </p>
          </>
        )}
      </form>

      <p className="mt-auto pt-10 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-700">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
