import { CircleAlert, CloudCheck, CloudUpload, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmSheet } from '../../components/ui/Sheet';
import { useOnline } from '../../hooks/useOnline';
import { useTimezone } from '../../hooks/useMoney';
import { discardItem, retryItem, syncNow, useOutbox } from '../../offline/engine';
import type { OutboxItem } from '../../offline/outbox';
import { formatDateTime } from '../../utils/format';

/** Everything recorded on this phone that hasn't reached the server yet. */
export default function SyncPage() {
  const items = useOutbox((s) => s.items);
  const syncing = useOutbox((s) => s.syncing);
  const authRequired = useOutbox((s) => s.authRequired);
  const online = useOnline();
  const tz = useTimezone();
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null);
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <>
      <PageHeader title="Waiting to sync" back={true} />
      <PageBody>
        {items.length === 0 ? (
          <EmptyState icon={<CloudCheck className="size-6" />} title="Everything is synced" description="All entries from this phone are saved on the server." />
        ) : (
          <>
            <Card className="px-4 py-3.5 text-[15px] text-ink-2">
              {online
                ? authRequired
                  ? 'Your login expired. Log in again and these entries will sync.'
                  : 'These will be sent automatically. You can also sync now.'
                : "You're offline. These entries are safe on this phone and will be sent when you're back online."}
            </Card>
            {online ? (
              <Button
                size="lg"
                block
                icon={<RefreshCw className="size-5" />}
                loading={syncing}
                onClick={() => void syncNow({ force: true })}
              >
                Sync now
              </Button>
            ) : null}
            <div className="flex flex-col gap-3">
              {sorted.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{item.summary.title}</p>
                      <p className="text-sm text-muted">
                        {[item.summary.detail, formatDateTime(item.createdAt, tz)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {item.status === 'FAILED' ? (
                      <Badge tone="bad">Needs attention</Badge>
                    ) : item.status === 'SYNCING' ? (
                      <Badge tone="brand">Syncing</Badge>
                    ) : (
                      <Badge tone="warn">Waiting</Badge>
                    )}
                  </div>
                  {item.status === 'FAILED' ? (
                    <>
                      <p className="mt-3 flex items-start gap-1.5 text-sm text-bad">
                        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {item.lastError ?? 'The server did not accept this entry.'}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" disabled={!online} onClick={() => void retryItem(item.id)}>
                          Try again
                        </Button>
                        <Button variant="dangerGhost" onClick={() => setDiscarding(item)}>
                          Discard
                        </Button>
                      </div>
                    </>
                  ) : item.attempts > 0 && item.lastError ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                      <CloudUpload className="size-3.5" aria-hidden />
                      Last try: {item.lastError}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          </>
        )}
      </PageBody>
      <ConfirmSheet
        open={discarding !== null}
        title="Discard this entry?"
        message={`"${discarding?.summary.title ?? ''}" will not be recorded anywhere. Only do this if you will enter it again, or it shouldn't have been recorded.`}
        confirmLabel="Discard"
        onClose={() => setDiscarding(null)}
        onConfirm={() => {
          if (discarding) void discardItem(discarding.id);
          setDiscarding(null);
        }}
      />
    </>
  );
}
