import { formatPhone, normalizePhone, type StaffDto } from '@wd/shared';
import { MessageCircle, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field } from '../../components/ui/Field';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { Sheet } from '../../components/ui/Sheet';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useMoney } from '../../hooks/useMoney';
import { ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { randomPin } from '../../utils/pin';
import { useAddStaff, useStaffList } from './api';

/** Owner: delivery staff, with what each has spent today. */
export default function StaffPage() {
  const staff = useStaffList();
  const format = useMoney();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Delivery staff"
        back="/more"
        action={
          <Button variant="ghost" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      <PageBody>
        <p className="px-1 text-sm text-muted">
          Staff record deliveries, payments, empties and expenses. They only see their own work for today, and orders you give them.
        </p>
        {staff.isPending ? (
          <ListSkeleton rows={3} />
        ) : staff.isError ? (
          <ErrorRetry message={errorMessage(staff.error)} onRetry={() => void staff.refetch()} />
        ) : staff.data.length === 0 ? (
          <EmptyState
            icon={<UserRound className="size-6" />}
            title="No delivery staff yet"
            description="Add the people who deliver for you. Each gets their own login."
            action={<Button onClick={() => setAdding(true)}>Add staff</Button>}
          />
        ) : (
          <ListCard>
            {staff.data.map((s) => (
              <ListRow
                key={s.id}
                to={`/staff/${s.id}`}
                title={s.name}
                subtitle={
                  s.active
                    ? `${s.today.deliveries} deliver${s.today.deliveries === 1 ? 'y' : 'ies'} today · ${s.today.cansDelivered} cans`
                    : formatPhone(s.phone)
                }
                trailing={
                  s.active ? (
                    <span className="flex flex-col items-end">
                      <span className="font-semibold text-ink tabular">{format(s.today.expenses)}</span>
                      <span className="text-xs text-muted">staff expense</span>
                    </span>
                  ) : (
                    <Badge>Turned off</Badge>
                  )
                }
              />
            ))}
          </ListCard>
        )}
      </PageBody>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add delivery staff">
        {adding ? <AddStaffForm onDone={() => setAdding(false)} /> : null}
      </Sheet>
    </>
  );
}

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const add = useAddStaff();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState(randomPin);
  const [error, setError] = useState<{ name?: string; phone?: string; pin?: string }>({});
  const [created, setCreated] = useState<{ staff: StaffDto; pin: string } | null>(null);

  if (created) return <ShareLogin name={created.staff.name} phone={created.staff.phone} pin={created.pin} onDone={onDone} />;

  const submit = () => {
    const normalized = normalizePhone(phone);
    const next: typeof error = {};
    if (!name.trim()) next.name = 'Enter their name';
    if (!normalized) next.phone = 'Enter a valid phone number';
    if (!/^\d{6}$/.test(pin)) next.pin = 'PIN must be 6 digits';
    setError(next);
    if (Object.keys(next).length || !normalized) return;
    add.mutate(
      { name: name.trim(), phone: normalized, pin },
      {
        onSuccess: (staff) => setCreated({ staff, pin }),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setError({ phone: err.message });
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={error.name} />
      <Field label="Phone number" type="tel" inputMode="tel" prefix="+91" value={phone} onChange={(e) => setPhone(e.target.value)} error={error.phone} />
      <PinInput pin={pin} setPin={setPin} error={error.pin} />
      <Button size="lg" block loading={add.isPending} onClick={submit}>
        Add staff
      </Button>
    </div>
  );
}

export function PinInput({ pin, setPin, error }: { pin: string; setPin: (pin: string) => void; error?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Field
        className="flex-1"
        label="PIN to log in"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        error={error}
      />
      <Button variant="secondary" className="h-12" onClick={() => setPin(randomPin())}>
        New
      </Button>
    </div>
  );
}

export function ShareLogin({ name, phone, pin, onDone }: { name: string; phone: string; pin: string; onDone: () => void }) {
  const message = `Hi ${name}! Log in to record deliveries at ${window.location.origin}\nPhone: ${formatPhone(phone)}\nPIN: ${pin}\nYou can change the PIN after logging in.`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-ink-2">Login is ready. Share these details with {name}:</p>
      <Card className="px-4 py-3 text-[15px]">
        <p>
          Phone: <span className="font-semibold">{formatPhone(phone)}</span>
        </p>
        <p>
          PIN: <span className="font-semibold tracking-widest tabular">{pin}</span>
        </p>
      </Card>
      <a
        href={`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`}
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
