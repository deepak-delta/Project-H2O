import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RecoveryCodesResult, RecoverySetupInfo } from '@wd/shared';
import { Copy, Eye, EyeOff, ExternalLink, QrCode, TimerOff } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, SectionTitle } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PinField } from '../../components/ui/PinField';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { api, ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { copyText } from '../../utils/clipboard';
import { digitsOnly, recoveryStatusKey, useRecoveryStatus } from './recovery';
import { RecoveryCodesView } from './RecoveryCodesView';

type Step =
  | { kind: 'confirm'; restart?: boolean }
  | { kind: 'resume' }
  | { kind: 'scan'; info: RecoverySetupInfo }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'expired' };

/**
 * Set up (or replace) PIN recovery with an authenticator app. Made for doing it on the same
 * phone: an "Open in authenticator app" link, and a setup key that's easy to copy or type.
 */
export default function RecoverySetupPage() {
  const status = useRecoveryStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [chosen, setStep] = useState<Step | null>(null);
  const replacing = status.data?.enabled ?? false;
  // Came back to an unfinished setup (the app may have reloaded while adding the key to the
  // authenticator): go straight to entering the code.
  const step: Step = chosen ?? (status.data?.pendingSetupExpiresAt ? { kind: 'resume' } : { kind: 'confirm' });
  const onVerified = (codes: string[]) => {
    void queryClient.invalidateQueries({ queryKey: recoveryStatusKey });
    setStep({ kind: 'codes', codes });
  };

  const finish = () => {
    void queryClient.invalidateQueries({ queryKey: recoveryStatusKey });
    void navigate('/settings/security', { replace: true });
  };

  return (
    <>
      <PageHeader title={replacing && step.kind !== 'codes' ? 'Replace authenticator' : 'Set up PIN recovery'} back="/settings/security" />
      <PageBody>
        {status.isPending ? (
          <ListSkeleton rows={3} />
        ) : !status.data?.available ? (
          <Card className="p-4 text-[15px] text-muted">PIN recovery isn't available yet. Please try again later.</Card>
        ) : step.kind === 'confirm' ? (
          <ConfirmStep replacing={replacing} restart={step.restart} onReady={(info) => setStep({ kind: 'scan', info })} />
        ) : step.kind === 'resume' ? (
          <ResumeStep
            onVerified={onVerified}
            onExpired={() => setStep({ kind: 'expired' })}
            onShowKey={() => setStep({ kind: 'confirm' })}
            onRestart={() => setStep({ kind: 'confirm', restart: true })}
          />
        ) : step.kind === 'scan' ? (
          <ScanStep info={step.info} onVerified={onVerified} onExpired={() => setStep({ kind: 'expired' })} />
        ) : step.kind === 'codes' ? (
          <RecoveryCodesView codes={step.codes} onDone={finish} />
        ) : (
          <Card className="flex flex-col items-center gap-3 px-5 py-7 text-center">
            <TimerOff className="size-10 text-warn" aria-hidden />
            <p className="text-lg font-semibold text-ink">This setup has expired</p>
            <p className="text-[15px] text-muted">For your security, setup must be finished within 15 minutes. Nothing was changed.</p>
            <Button onClick={() => setStep({ kind: 'confirm' })}>Start again</Button>
          </Card>
        )}
      </PageBody>
    </>
  );
}

function ConfirmStep({ replacing, restart, onReady }: { replacing: boolean; restart?: boolean; onReady: (info: RecoverySetupInfo) => void }) {
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ currentPin?: string; code?: string; form?: string }>({});

  const start = useMutation({
    mutationFn: () =>
      api.post<RecoverySetupInfo>('/auth/recovery/setup', { currentPin: pin, ...(replacing ? { code } : {}), ...(restart ? { restart: true } : {}) }),
    onSuccess: onReady,
    onError: (err) => {
      if (err instanceof ApiError && err.fields) setErrors({ currentPin: err.fields.currentPin, code: err.fields.code, form: err.fields.currentPin || err.fields.code ? undefined : err.message });
      else setErrors({ form: errorMessage(err) });
    },
  });

  const submit = () => {
    const next: typeof errors = {};
    if (!/^\d{6}$/.test(pin)) next.currentPin = 'Enter your 6-digit PIN';
    if (replacing && !/^\d{6}$/.test(code)) next.code = 'Enter the 6-digit code';
    setErrors(next);
    if (!next.currentPin && !next.code) start.mutate();
  };

  return (
    <>
      <p className="px-1 text-[15px] text-muted">
        {restart
          ? "A new setup key will be made. First delete the old Water Delivery entry from your authenticator app, so you don't mix them up."
          : replacing
          ? 'Moving to a new phone or app? Confirm with your PIN and a code from your current authenticator app. Your old authenticator stops working once the new one is set up.'
          : "If you ever forget your PIN, a code from an authenticator app (Google Authenticator, Microsoft Authenticator or Authy) lets you set a new one yourself. No SMS needed. It's free."}
      </p>
      <Card className="flex flex-col gap-4 p-4">
        <PinField label="Your current PIN" value={pin} onChange={setPin} error={errors.currentPin} revealable autoFocus />
        {replacing ? (
          <Field
            label="Code from your current authenticator app"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(digitsOnly(e.target.value))}
            error={errors.code}
          />
        ) : null}
        {errors.form ? (
          <p role="alert" className="rounded-xl bg-bad-bg px-3.5 py-3 text-sm text-bad">
            {errors.form}
          </p>
        ) : null}
        <Button size="lg" block loading={start.isPending} onClick={submit}>
          Continue
        </Button>
      </Card>
    </>
  );
}

function ScanStep({ info, onVerified, onExpired }: { info: RecoverySetupInfo; onVerified: (codes: string[]) => void; onExpired: () => void }) {
  const [keyShown, setKeyShown] = useState(true);
  const [qrShown, setQrShown] = useState(false);
  const copyKey = () =>
    void copyText(info.secret.replace(/ /g, '')).then((ok) => (ok ? toast.success('Setup key copied. Paste it into your authenticator app.') : toast.error("Couldn't copy. Type the key instead.")));

  return (
    <>
      <section>
        <SectionTitle>1 · Add it to your authenticator app</SectionTitle>
        <Card className="flex flex-col gap-4 p-4">
          <a
            href={info.otpauthUri}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 font-semibold text-white"
          >
            <ExternalLink className="size-5" aria-hidden />
            Open in authenticator app
          </a>
          <p className="-mt-1 text-center text-sm text-muted">On this phone, this adds the account in one tap. If nothing opens, add it by hand below.</p>

          <dl className="divide-y divide-line rounded-xl border border-line text-[15px]">
            <SetupRow label="App / issuer" value={info.issuer} />
            <SetupRow label="Account name" value={info.accountName} />
            <div className="flex flex-col gap-1 px-3.5 py-3">
              <dt className="text-muted">Setup key</dt>
              <dd className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[18px] leading-relaxed font-semibold tracking-wider break-words text-ink" data-setup-key>
                    {keyShown ? info.secret : info.secret.replace(/[A-Z2-7]/g, '•')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setKeyShown((v) => !v)}
                    aria-pressed={keyShown}
                    aria-label={keyShown ? 'Hide setup key' : 'Show setup key'}
                    className="flex h-11 shrink-0 items-center gap-1.5 px-1 text-sm font-semibold text-brand-700"
                  >
                    {keyShown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    {keyShown ? 'Hide' : 'Show'}
                  </button>
                </div>
                <Button variant="secondary" icon={<Copy className="size-5" />} onClick={copyKey}>
                  Copy setup key
                </Button>
              </dd>
            </div>
            <SetupRow label="Type" value="Time-based" />
            <SetupRow label="Code length" value={`${info.digits} digits, new every ${info.periodSeconds} s`} />
          </dl>

          <ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
            <li>Open <strong>Google Authenticator</strong> (or Microsoft Authenticator / Authy).</li>
            <li>Tap <strong>+</strong>.</li>
            <li>Select <strong>Enter setup key</strong>.</li>
            <li>
              For the account name enter <strong>{info.accountName}</strong>, and paste or type the <strong>setup key</strong>.
            </li>
            <li>Select <strong>Time-based</strong>, then tap <strong>Add</strong>.</li>
            <li>Come back here and enter the 6-digit code it shows.</li>
          </ol>

          <button
            type="button"
            onClick={() => setQrShown((v) => !v)}
            aria-expanded={qrShown}
            className="flex h-11 items-center gap-2 self-start text-[15px] font-semibold text-brand-700"
          >
            <QrCode className="size-5" aria-hidden />
            {qrShown ? 'Hide QR code' : 'Setting up on another phone? Show QR code'}
          </button>
          {qrShown ? <img src={info.qrDataUrl} alt="QR code for your authenticator app" className="mx-auto size-56 rounded-lg bg-white p-2" /> : null}
        </Card>
      </section>

      <section>
        <SectionTitle>2 · Enter the 6-digit code</SectionTitle>
        <CodeEntry expiresAt={info.expiresAt} onVerified={onVerified} onExpired={onExpired} />
      </section>
    </>
  );
}

/** The 6-digit code that proves the authenticator has the key; turns recovery on. */
function CodeEntry({ expiresAt, onVerified, onExpired }: { expiresAt: string; onVerified: (codes: string[]) => void; onExpired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const until = new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const verify = useMutation({
    mutationFn: () => api.post<RecoveryCodesResult>('/auth/recovery/verify', { code }),
    onSuccess: (r) => onVerified(r.recoveryCodes),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'EXPIRED') return onExpired();
      setCode('');
      setError(errorMessage(err));
    },
  });

  return (
    <Card className="flex flex-col gap-4 p-4">
      <Field
        label="Code from your authenticator app"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={(e) => {
          setError(null);
          setCode(digitsOnly(e.target.value));
        }}
        error={error ?? undefined}
        hint={`Finish by ${until}.`}
      />
      <Button size="lg" block loading={verify.isPending} disabled={code.length !== 6} onClick={() => verify.mutate()}>
        Verify and turn on
      </Button>
    </Card>
  );
}

/** Back on an unfinished setup: the key is already in the authenticator, so just ask for a code. */
function ResumeStep({
  onVerified,
  onExpired,
  onShowKey,
  onRestart,
}: {
  onVerified: (codes: string[]) => void;
  onExpired: () => void;
  onShowKey: () => void;
  onRestart: () => void;
}) {
  const status = useRecoveryStatus();
  const expiresAt = status.data?.pendingSetupExpiresAt;
  if (!expiresAt) return null;
  return (
    <>
      <p className="px-1 text-[15px] text-muted">
        Finish setting up: enter the 6-digit code your authenticator app shows for <strong>Water Delivery</strong>.
      </p>
      <CodeEntry expiresAt={expiresAt} onVerified={onVerified} onExpired={onExpired} />
      <Button variant="secondary" block onClick={onShowKey}>
        Show the setup key again
      </Button>
      <Button variant="ghost" block onClick={onRestart}>
        Start over with a new key
      </Button>
    </>
  );
}

function SetupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}
