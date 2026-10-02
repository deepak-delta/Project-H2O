import { formatPhone, normalizePhone, type StoreDetail } from '@wd/shared';
import { MessageCircle, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { ConfirmSheet, Sheet } from '../../components/ui/Sheet';
import { ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useDisableStoreLogin, useSetStoreLogin } from './api';

/** Six random digits, avoiding repeats like 111111 and runs like 123456. */
function randomPin(): string {
  for (;;) {
    const digits = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => String(b % 10)).join('');
    const sequential = '0123456789012345'.includes(digits) || '9876543210987654'.includes(digits);
    if (new Set(digits).size > 2 && !sequential) return digits;
  }
}

/** Lets the supplier switch on the store's own app login and share it. */
export function StoreAccessCard({ store }: { store: StoreDetail }) {
  // Remember which flow was opened: the title must not flip once the save updates the store.
  const [editing, setEditing] = useState<'enable' | 'reset' | null>(null);
  const [disabling, setDisabling] = useState(false);
  const disable = useDisableStoreLogin(store.id);

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Smartphone className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">Store app</p>
        <p className="truncate text-sm text-muted">
          {store.hasLogin && store.loginPhone ? `On · logs in with ${formatPhone(store.loginPhone)}` : 'Let them order water from their phone'}
        </p>
      </div>
      {store.hasLogin ? (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={() => setEditing('reset')}>
            Reset PIN
          </Button>
          <Button variant="dangerGhost" onClick={() => setDisabling(true)}>
            Turn off
          </Button>
        </div>
      ) : store.status === 'ACTIVE' ? (
        <Button variant="secondary" onClick={() => setEditing('enable')}>
          Give access
        </Button>
      ) : null}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'reset' ? 'Reset store PIN' : 'Store app access'}>
        {editing ? <AccessForm store={store} reset={editing === 'reset'} onDone={() => setEditing(null)} /> : null}
      </Sheet>
      <ConfirmSheet
        open={disabling}
        title="Turn off store app?"
        message={`${store.name} will be logged out and won't be able to log in. Their orders and history stay.`}
        confirmLabel="Turn off"
        loading={disable.isPending}
        onClose={() => setDisabling(false)}
        onConfirm={() =>
          disable.mutate(undefined, {
            onSuccess: () => {
              setDisabling(false);
              toast.success('Store app access turned off.');
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </Card>
  );
}

function AccessForm({ store, reset, onDone }: { store: StoreDetail; reset: boolean; onDone: () => void }) {
  const save = useSetStoreLogin(store.id);
  const initialPhone = store.loginPhone ?? store.phone;
  const [phone, setPhone] = useState(initialPhone ? formatPhone(initialPhone) : '');
  const [pin, setPin] = useState(randomPin);
  const [error, setError] = useState<{ phone?: string; pin?: string }>({});
  const [shared, setShared] = useState<{ phone: string; pin: string } | null>(null);

  if (shared) {
    const message = `Hi! You can now order water from ${window.location.origin}\nPhone: ${formatPhone(shared.phone)}\nPIN: ${shared.pin}\nYou can change the PIN after logging in.`;
    const wa = shared.phone.replace(/\D/g, '');
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-ink-2">
          Login is ready. Share these details with {store.ownerName ?? store.name}:
        </p>
        <Card className="px-4 py-3 text-[15px]">
          <p>
            Phone: <span className="font-semibold">{formatPhone(shared.phone)}</span>
          </p>
          <p>
            PIN: <span className="font-semibold tracking-widest tabular">{shared.pin}</span>
          </p>
        </Card>
        <a
          href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 font-semibold text-white"
        >
          <MessageCircle className="size-5" aria-hidden />
          Send on WhatsApp
        </a>
        <Button variant="secondary" size="lg" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const submit = () => {
    const normalized = normalizePhone(phone);
    const next: typeof error = {};
    if (!normalized) next.phone = 'Enter a valid phone number';
    if (!/^\d{6}$/.test(pin)) next.pin = 'PIN must be 6 digits';
    setError(next);
    if (!normalized || next.pin) return;
    save.mutate(
      { phone: normalized, pin },
      {
        onSuccess: () => setShared({ phone: normalized, pin }),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setError({ phone: err.message });
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Store's phone number"
        type="tel"
        inputMode="tel"
        prefix="+91"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={error.phone}
      />
      <div className="flex items-end gap-2">
        <Field
          className="flex-1"
          label="PIN for the store"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          error={error.pin}
        />
        <Button variant="secondary" className="h-12" onClick={() => setPin(randomPin())}>
          New
        </Button>
      </div>
      {reset ? <p className="text-sm text-muted">The store will be logged out of every phone.</p> : null}
      <Button size="lg" block loading={save.isPending} onClick={submit}>
        {reset ? 'Reset PIN' : 'Turn on'}
      </Button>
    </div>
  );
}
