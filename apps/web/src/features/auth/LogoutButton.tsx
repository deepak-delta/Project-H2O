import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ConfirmSheet } from '../../components/ui/Sheet';
import { useOnline } from '../../hooks/useOnline';
import { useOutbox } from '../../offline/engine';
import { toast } from '../../stores/toast';
import { useLogout } from './session';

/**
 * Logging out needs the server (the session cookie can only be cleared there). Entries still
 * waiting to sync are kept on the phone and sync after the same person logs in again.
 */
export function LogoutButton() {
  const logout = useLogout();
  const online = useOnline();
  const waiting = useOutbox((s) => s.items.length);
  const [confirming, setConfirming] = useState(false);

  const start = () => {
    if (!online) return toast.error('Connect to the internet to log out.');
    if (waiting > 0) return setConfirming(true);
    logout.mutate();
  };

  return (
    <>
      <Button variant="secondary" block icon={<LogOut className="size-5" />} loading={logout.isPending} onClick={start}>
        Log out
      </Button>
      <ConfirmSheet
        open={confirming}
        title="Some entries haven't synced"
        message={`${waiting} entr${waiting === 1 ? 'y is' : 'ies are'} still only on this phone. They'll stay saved here and sync when you log in again on this phone.`}
        confirmLabel="Log out anyway"
        tone="primary"
        loading={logout.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => logout.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </>
  );
}
