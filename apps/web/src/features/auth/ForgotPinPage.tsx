import { useMutation } from '@tanstack/react-query';
import { formatPhone, normalizePhone, type PinResetMethod } from '@wd/shared';
import { CircleCheck, Lock, TimerOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { PinField } from '../../components/ui/PinField';
import { Segmented } from '../../components/ui/Segmented';
import { api, ApiError, errorMessage } from '../../services/api';
import { DEVICE_KEYS, deviceStorage } from '../../utils/storage';
import { digitsOnly } from '../settings/recovery';
import { AuthLayout } from './AuthLayout';

type Step = 'phone' | 'code' | 'pin' | 'done' | 'expired' | 'locked';

/** "ABCDE-FGHJK" while typing a recovery or support code. */
const formatCode = (v: string) => {
  const c = v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10);
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
};

/**
 * Forgot PIN: phone → authenticator / recovery / support code → new PIN. The server answers the
 * same whether or not the phone has an account, so the screens never say "no such account".
 */
export default function ForgotPinPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(deviceStorage.get(DEVICE_KEYS.lastPhone) ?? '');
  const [method, setMethod] = useState<PinResetMethod>('TOTP');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [lockedMessage, setLockedMessage] = useState('');

  const handle = (err: unknown, field?: string) => {
    if (err instanceof ApiError && err.code === 'EXPIRED') return setStep('expired');
    if (err instanceof ApiError && err.code === 'LOCKED') {
      setLockedMessage(err.message);
      return setStep('locked');
    }
    setError({ field: err instanceof ApiError && err.fields ? (Object.keys(err.fields)[0] ?? field) : field, message: errorMessage(err) });
  };

  const start = useMutation({
    mutationFn: () => api.post('/auth/pin-reset/start', { phone }),
    onSuccess: () => {
      setError(null);
      setCode('');
      setStep('code');
    },
    onError: (err) => handle(err, 'phone'),
  });
  const verify = useMutation({
    mutationFn: () => api.post('/auth/pin-reset/verify', { method, code }),
    onSuccess: () => {
      setError(null);
      setStep('pin');
    },
    onError: (err) => {
      setCode('');
      handle(err, 'code');
    },
  });
  const complete = useMutation({
    mutationFn: () => api.post<void>('/auth/pin-reset/complete', { pin, confirmPin }),
    onSuccess: () => {
      const normalized = normalizePhone(phone);
      if (normalized) deviceStorage.set(DEVICE_KEYS.lastPhone, formatPhone(normalized));
      setStep('done');
    },
    onError: (err) => handle(err, 'pin'),
  });

  const restart = () => {
    setStep('phone');
    setCode('');
    setPin('');
    setConfirmPin('');
    setError(null);
  };
  const fieldError = (name: string) => (error && error.field === name ? error.message : undefined);
  const formError = error && !['phone', 'code', 'pin', 'confirmPin'].includes(error.field ?? '') ? error.message : null;

  if (step === 'done') {
    return (
      <AuthLayout title="PIN changed">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-5 py-7 text-center shadow-card">
          <CircleCheck className="size-12 text-ok" aria-hidden />
          <p className="text-[15px] text-ink-2">
            Your new PIN is saved. For your security you've been logged out on every device. Log in with your new PIN.
          </p>
        </div>
        <Button size="lg" block className="mt-5" onClick={() => navigate('/login', { replace: true })}>
          Log in
        </Button>
      </AuthLayout>
    );
  }

  if (step === 'expired' || step === 'locked') {
    const isLocked = step === 'locked';
    return (
      <AuthLayout title={isLocked ? 'Try again later' : 'This reset has expired'}>
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-5 py-7 text-center shadow-card">
          {isLocked ? <Lock className="size-10 text-bad" aria-hidden /> : <TimerOff className="size-10 text-warn" aria-hidden />}
          <p className="text-[15px] text-ink-2">
            {isLocked ? lockedMessage : 'For your security, a PIN reset must be finished within a few minutes. Nothing was changed.'}
          </p>
        </div>
        <Button size="lg" block className="mt-5" variant={isLocked ? 'secondary' : 'primary'} onClick={restart}>
          Start again
        </Button>
        <BackToLogin />
      </AuthLayout>
    );
  }

  if (step === 'pin') {
    return (
      <AuthLayout title="Choose a new PIN" subtitle="6 digits you'll remember, different from your old PIN.">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!/^\d{6}$/.test(pin)) return setError({ field: 'pin', message: 'PIN must be exactly 6 digits' });
            if (pin !== confirmPin) return setError({ field: 'confirmPin', message: 'The two PINs are different' });
            complete.mutate();
          }}
        >
          <PinField label="New PIN" autoComplete="new-password" value={pin} onChange={setPin} error={fieldError('pin')} revealable autoFocus />
          <PinField label="Type it again" autoComplete="new-password" value={confirmPin} onChange={setConfirmPin} error={fieldError('confirmPin')} revealable />
          {formError ? <FormError message={formError} /> : null}
          <Button type="submit" size="lg" block loading={complete.isPending}>
            Save new PIN
          </Button>
        </form>
      </AuthLayout>
    );
  }

  if (step === 'code') {
    return (
      <AuthLayout title="Enter a code" subtitle={`To reset the PIN for ${formatPhone(normalizePhone(phone) ?? phone)}.`}>
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (method === 'TOTP' ? code.length !== 6 : code.replace('-', '').length !== 10) {
              return setError({ field: 'code', message: method === 'TOTP' ? 'Enter the 6-digit code' : 'Enter the 10-character code, e.g. 7KQ2M-XW9PD' });
            }
            verify.mutate();
          }}
        >
          {method !== 'ASSISTED' ? (
            <Segmented<PinResetMethod>
              label="Code type"
              value={method}
              onChange={(m) => {
                setMethod(m);
                setCode('');
                setError(null);
              }}
              options={[
                { value: 'TOTP', label: 'Authenticator app' },
                { value: 'RECOVERY', label: 'Recovery code' },
              ]}
            />
          ) : null}
          {method === 'TOTP' ? (
            <Field
              key="totp"
              label="6-digit code from your authenticator app"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
              error={fieldError('code')}
              hint="The code changes every 30 seconds. Use the one showing now."
            />
          ) : (
            <Field
              key={method}
              label={method === 'RECOVERY' ? 'One of your recovery codes' : 'Code from support'}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="7KQ2M-XW9PD"
              autoFocus
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              error={fieldError('code')}
              hint={method === 'RECOVERY' ? 'Each recovery code works once.' : 'Valid for 30 minutes, once.'}
            />
          )}
          {formError ? <FormError message={formError} /> : null}
          <Button type="submit" size="lg" block loading={verify.isPending}>
            Continue
          </Button>
        </form>

        <details className="mt-6 rounded-2xl bg-surface p-4 text-[15px] text-ink-2 shadow-card">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">Lost your authenticator and recovery codes?</summary>
          <div className="mt-2 space-y-3">
            <p>
              <strong>Delivery staff and clients:</strong> ask your business owner. They can set a new PIN for you in the app.
            </p>
            <p>
              <strong>Business owners:</strong> contact support. After confirming it's really you (by calling you back on your registered
              number), they'll give you a one-time support code.
            </p>
            {method === 'ASSISTED' ? (
              <Button variant="secondary" block onClick={() => (setMethod('TOTP'), setCode(''), setError(null))}>
                Use my authenticator or a recovery code
              </Button>
            ) : (
              <Button variant="secondary" block onClick={() => (setMethod('ASSISTED'), setCode(''), setError(null))}>
                I have a code from support
              </Button>
            )}
          </div>
        </details>
        <BackToLogin />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot your PIN?" subtitle="Reset it with your authenticator app or a recovery code.">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!normalizePhone(phone)) return setError({ field: 'phone', message: 'Enter a valid phone number' });
          start.mutate();
        }}
      >
        <Field
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          placeholder="98765 43210"
          prefix="+91"
          autoFocus
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fieldError('phone')}
        />
        {formError ? <FormError message={formError} /> : null}
        <Button type="submit" size="lg" block loading={start.isPending}>
          Continue
        </Button>
      </form>
      <p className="mt-5 text-sm text-muted">
        This works if you set up PIN recovery earlier in <strong>Login &amp; security</strong>. Otherwise, staff and clients can ask their
        business owner for a new PIN.
      </p>
      <BackToLogin />
    </AuthLayout>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl bg-bad-bg px-3.5 py-3 text-sm text-bad">
      {message}
    </p>
  );
}

function BackToLogin() {
  return (
    <p className="mt-auto pt-10 text-center text-sm">
      <Link to="/login" className="font-semibold text-brand-700">
        Back to log in
      </Link>
    </p>
  );
}
