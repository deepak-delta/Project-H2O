import { formatPhone } from '@wd/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { ConfirmSheet, Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { randomPin } from '../../utils/pin';
import { useDeleteStaff, useResetStaffPin, useStaffDay, useStaffList, useUpdateStaff } from './api';
import { PinInput, ShareLogin } from './StaffPage';
import { StaffDay } from './StaffDay';

/** Owner: one member of staff's day, and their login. */
export default function StaffDayPage() {
  const { id = '' } = useParams();
  const day = useStaffDay(id);
  const list = useStaffList();
  const member = list.data?.find((s) => s.id === id);
  const update = useUpdateStaff(id);
  const [confirmOff, setConfirmOff] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteStaff(id);
  const navigate = useNavigate();

  const setActive = (active: boolean) =>
    update.mutate(
      { active },
      {
        onSuccess: (s) => {
          setConfirmOff(false);
          toast.success(active ? `${s.name} can log in again.` : `${s.name} is logged out and can't log in.`);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <>
      <PageHeader title={member?.name ?? 'Staff'} subtitle={member ? formatPhone(member.phone) : undefined} back="/staff" />
      <PageBody>
        {day.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : day.isError ? (
          <ErrorRetry message={errorMessage(day.error)} onRetry={() => void day.refetch()} />
        ) : (
          <StaffDay day={day.data} self={false} />
        )}

        {member ? (
          member.active ? (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setResetting(true)}>
                Reset PIN
              </Button>
              <Button variant="dangerGhost" onClick={() => setConfirmOff(true)}>
                Turn off
              </Button>
            </div>
          ) : (
            <Button variant="secondary" block loading={update.isPending} onClick={() => setActive(true)}>
              Turn login back on
            </Button>
          )
        ) : null}
        {member ? (
          <Button variant="dangerGhost" block onClick={() => setConfirmDelete(true)}>
            Delete {member.name}
          </Button>
        ) : null}
      </PageBody>

      <ConfirmSheet
        open={confirmOff}
        title={`Turn off ${member?.name ?? 'staff'}?`}
        message="They will be logged out and can't log in. Orders you gave them come back to you. Their past work stays in your records."
        confirmLabel="Turn off"
        loading={update.isPending}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => setActive(false)}
      />
      <ConfirmSheet
        open={confirmDelete}
        title={`Delete ${member?.name ?? 'staff'}?`}
        message="They're logged out and can never log in again, and orders you gave them come back to you. Their past deliveries, payments and expenses stay in your records under their name. Their phone number can be used for someone new."
        confirmLabel="Delete"
        loading={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success(`${member?.name ?? 'Staff member'} deleted.`);
              void navigate('/staff', { replace: true });
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
      <Sheet open={resetting} onClose={() => setResetting(false)} title="Reset PIN">
        {resetting && member ? <ResetPinForm id={id} name={member.name} phone={member.phone} onDone={() => setResetting(false)} /> : null}
      </Sheet>
    </>
  );
}

function ResetPinForm({ id, name, phone, onDone }: { id: string; name: string; phone: string; onDone: () => void }) {
  const reset = useResetStaffPin(id);
  const [pin, setPin] = useState(randomPin);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  if (done) return <ShareLogin name={name} phone={phone} pin={pin} onDone={onDone} />;
  return (
    <div className="flex flex-col gap-4">
      <PinInput pin={pin} setPin={setPin} error={error} />
      <p className="text-sm text-muted">{name} will be logged out of every phone.</p>
      <Button
        size="lg"
        block
        loading={reset.isPending}
        onClick={() => {
          if (!/^\d{6}$/.test(pin)) return setError('PIN must be 6 digits');
          reset.mutate(pin, { onSuccess: () => setDone(true), onError: (err) => toast.error(errorMessage(err)) });
        }}
      >
        Reset PIN
      </Button>
    </div>
  );
}
