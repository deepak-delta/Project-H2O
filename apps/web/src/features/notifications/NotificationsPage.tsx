import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Share, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, SectionTitle } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useSession } from '../auth/session';
import { disablePush, enablePush, getPushState, type PushState } from './push';

const pushStateKey = ['push-state'] as const;

const WHAT_YOU_GET = {
  SUPPLIER: ['New orders from stores', 'Orders a store cancels', 'When filled cans are running low'],
  STORE: ['Order accepted and on the way', 'Deliveries, with your new balance', 'Payments received', 'Payment reminders'],
  STAFF: ['Orders the owner gives you to deliver'],
} as const;

export default function NotificationsPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: pushStateKey, queryFn: getPushState, staleTime: 0 });
  const setState = (s: PushState) => queryClient.setQueryData(pushStateKey, s);

  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: (s) => {
      setState(s);
      if (s === 'on') toast.success('Notifications are on for this phone.');
      if (s === 'blocked') toast.error('Notifications are blocked. Allow them in your browser or phone settings.');
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't turn on notifications. Please try again.")),
  });
  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => {
      setState('off');
      toast.success('Notifications are off for this phone.');
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ sent: number }>('/push/test'),
    onSuccess: (r) => (r.sent > 0 ? toast.success('Test sent. It should appear in a moment.') : toast.error('No device received it. Turn notifications off and on again.')),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <>
      <PageHeader title="Notifications" back={true} />
      <PageBody>
        {state.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Card className="flex flex-col gap-4 p-4">
            <StateMessage state={state.data ?? 'unsupported'} />
            {state.data === 'off' ? (
              <Button size="lg" block icon={<Bell className="size-5" />} loading={enable.isPending} onClick={() => enable.mutate()}>
                Turn on notifications
              </Button>
            ) : null}
            {state.data === 'on' ? (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
                  Send a test
                </Button>
                <Button variant="dangerGhost" icon={<BellOff className="size-5" />} loading={disable.isPending} onClick={() => disable.mutate()}>
                  Turn off
                </Button>
              </div>
            ) : null}
          </Card>
        )}
        <section>
          <SectionTitle>You'll be told about</SectionTitle>
          <Card className="px-4 py-3">
            <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-2">
              {WHAT_YOU_GET[user.role].map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        </section>
        <p className="px-1 text-sm text-muted">Notifications are set per phone. Turn them on on each phone you use.</p>
      </PageBody>
    </>
  );
}

function StateMessage({ state }: { state: PushState }) {
  switch (state) {
    case 'on':
      return <Line icon={<Bell className="size-5 text-ok" />} title="On for this phone" text="You'll get alerts even when the app is closed." />;
    case 'off':
      return <Line icon={<BellOff className="size-5 text-muted" />} title="Off for this phone" text="Turn them on to hear about orders and payments straight away." />;
    case 'blocked':
      return (
        <Line
          icon={<BellOff className="size-5 text-bad" />}
          title="Blocked"
          text="This phone is set to block notifications from the app. Allow them in the browser's site settings (or Settings → Notifications on iPhone), then come back."
        />
      );
    case 'needs-install':
      return (
        <Line
          icon={<Share className="size-5 text-brand-700" />}
          title="Add the app to your Home Screen first"
          text="On iPhone, notifications work once the app is installed: tap Share, then “Add to Home Screen”, and open it from there."
        />
      );
    case 'server-off':
      return <Line icon={<BellOff className="size-5 text-muted" />} title="Not available yet" text="Notifications haven't been set up for this business yet." />;
    case 'unsupported':
      return (
        <Line
          icon={<Smartphone className="size-5 text-muted" />}
          title="Not supported here"
          text="This browser can't receive notifications. Use the installed app in Chrome (Android) or Safari (iPhone)."
        />
      );
  }
}

function Line({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}
