import { formatPhone, type OutstandingRow } from '@wd/shared';
import { HandCoins, MessageCircle, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { Segmented } from '../../components/ui/Segmented';
import { Sheet } from '../../components/ui/Sheet';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { formatDate } from '../../utils/format';
import { useSession } from '../auth/session';
import { StoreSearchBox } from '../stores/StorePicker';
import { useDues, useOutstandingReport } from './api';
import { CsvButton } from './ReportBits';
import { reminderMessage } from './reminder';

type Sort = 'amount' | 'name';

/** Rows matching what's typed so far: client or owner name, or 3+ digits of the phone. */
function matches(rows: OutstandingRow[], search: string): OutstandingRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  const digits = q.replace(/\D/g, '');
  return rows.filter(
    (r) =>
      r.storeName.toLowerCase().includes(q) ||
      (r.ownerName?.toLowerCase().includes(q) ?? false) ||
      (digits.length >= 3 && (r.phone?.includes(digits) ?? false)),
  );
}

/** Who owes money, biggest first — with a one-tap WhatsApp reminder listing the unpaid bills. */
export default function OutstandingReportPage() {
  const report = useOutstandingReport();
  const format = useMoney();
  const tz = useTimezone();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('amount');
  const [reminding, setReminding] = useState<OutstandingRow | null>(null);

  const rows = useMemo(() => {
    const found = matches(report.data?.rows ?? [], search);
    return sort === 'name' ? [...found].sort((a, b) => a.storeName.localeCompare(b.storeName)) : found;
  }, [report.data, search, sort]);

  const exportCsv = () =>
    report.data &&
    downloadCsv(
      'outstanding-credit.csv',
      ['Client', 'Phone', 'Balance', 'Cans held', 'Last payment', 'Last delivery'],
      report.data.rows.map((r) => [
        r.storeName,
        r.phone ? formatPhone(r.phone) : '',
        r.balance,
        r.cans,
        r.lastPaymentAt ? formatDate(r.lastPaymentAt, tz) : '',
        r.lastDeliveryAt ? formatDate(r.lastDeliveryAt, tz) : '',
      ]),
    );

  return (
    <>
      <PageHeader title="Who owes money" back="/reports" action={<CsvButton onClick={exportCsv} disabled={!report.data} />} />
      <PageBody>
        {report.isPending ? (
          <ListSkeleton rows={6} />
        ) : report.isError ? (
          <ErrorRetry message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
        ) : report.data.rows.length === 0 ? (
          <EmptyState icon={<HandCoins className="size-6" />} title="Nobody owes you money" description="All clients are settled." />
        ) : (
          <>
            <Card className="px-4 py-3.5">
              <p className="text-[13px] text-muted">Total outstanding</p>
              <p className="text-2xl font-semibold text-bad tabular">{format(report.data.total)}</p>
              <p className="text-sm text-muted">
                {report.data.rows.length} client{report.data.rows.length === 1 ? '' : 's'}
              </p>
            </Card>
            <StoreSearchBox value={search} onChange={setSearch} />
            <Segmented
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'amount', label: 'Most owed' },
                { value: 'name', label: 'A–Z' },
              ]}
            />
            {rows.length === 0 ? (
              <EmptyState icon={<SearchX className="size-6" />} title="No client found" description={`Nobody owing money matches "${search.trim()}".`} />
            ) : (
              <ListCard>
                {rows.map((r) => (
                  <div key={r.storeId} className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <ListRow
                        to={`/stores/${r.storeId}`}
                        title={r.storeName}
                        subtitle={r.lastPaymentAt ? `Last paid ${formatDate(r.lastPaymentAt, tz)}` : 'No payments yet'}
                        trailing={<span className="font-semibold text-bad tabular">{format(r.balance)}</span>}
                      />
                    </div>
                    {r.phone ? (
                      <button
                        type="button"
                        onClick={() => setReminding(r)}
                        aria-label={`Send ${r.storeName} a payment reminder on WhatsApp`}
                        className="mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-brand-700 hover:bg-brand-50"
                      >
                        <MessageCircle className="size-5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </ListCard>
            )}
          </>
        )}
      </PageBody>
      <ReminderSheet row={reminding} onClose={() => setReminding(null)} />
    </>
  );
}

/** Shows the reminder (with every unpaid bill) before it goes to WhatsApp. */
function ReminderSheet({ row, onClose }: { row: OutstandingRow | null; onClose: () => void }) {
  const dues = useDues(row?.storeId ?? null);
  const format = useMoney();
  const tz = useTimezone();
  const { business } = useSession();

  const message =
    row && dues.data
      ? reminderMessage(dues.data, {
          businessName: business.businessName,
          greet: row.ownerName?.trim() || row.storeName,
          format,
          formatDate: (iso) => formatDate(iso, tz),
        })
      : null;
  const wa = row?.phone?.replace(/\D/g, '');

  return (
    <Sheet open={row !== null} onClose={onClose} title="Payment reminder">
      {dues.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : dues.isError ? (
        <ErrorRetry message={errorMessage(dues.error)} onRetry={() => void dues.refetch()} />
      ) : message && wa ? (
        <>
          <p className="mb-2 text-sm text-muted">To {row?.storeName}</p>
          <pre
            aria-label="Reminder message"
            className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas p-3 font-sans text-[15px] text-ink-2"
          >
            {/* WhatsApp shows *…* as bold; here the stars would only be noise. */}
            {message.replaceAll('*', '')}
          </pre>
          <a
            href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
            className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-base font-semibold text-white hover:bg-brand-800"
          >
            <MessageCircle className="size-5" aria-hidden />
            Send on WhatsApp
          </a>
        </>
      ) : null}
    </Sheet>
  );
}
