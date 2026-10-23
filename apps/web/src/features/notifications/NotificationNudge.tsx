import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';
import { getPushState } from './push';

/**
 * For delivery staff: until this phone gets notifications, a card on their day says so, since
 * otherwise they only learn about orders given to them by opening the app.
 */
export function NotificationNudge() {
  const state = useQuery({ queryKey: ['push-state'], queryFn: getPushState, staleTime: 0 });
  if (state.data !== 'off' && state.data !== 'blocked' && state.data !== 'needs-install') return null;
  return (
    <Card className="flex items-center gap-3 border-warn/30 bg-warn-bg p-4">
      <BellRing className="size-6 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Notifications are off</p>
        <p className="text-sm text-ink-2">Turn them on to hear when the owner gives you an order.</p>
      </div>
      <Link to="/settings/notifications" className="flex h-11 shrink-0 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
        Turn on
      </Link>
    </Card>
  );
}
