import { formatPhone } from '@wd/shared';
import { HandCoins, MessageCircle } from 'lucide-react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { formatDate } from '../../utils/format';
import { useSession } from '../auth/session';
import { useOutstandingReport } from './api';
import { CsvButton } from './ReportBits';

/** Who owes money, biggest first — with a one-tap WhatsApp reminder. */
export default function OutstandingReportPage() {
  const report = useOutstandingReport();
  const format = useMoney();
  const tz = useTimezone();
  const { business } = useSession();

  const exportCsv = () =>
    report.data &&
    downloadCsv(
      'outstanding-credit.csv',
      ['Store', 'Phone', 'Balance', 'Cans held', 'Last payment', 'Last delivery'],
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
          <EmptyState icon={<HandCoins className="size-6" />} title="Nobody owes you money" description="All stores are settled." />
        ) : (
          <>
            <Card className="px-4 py-3.5">
              <p className="text-[13px] text-muted">Total outstanding</p>
              <p className="text-2xl font-semibold text-bad tabular">{format(report.data.total)}</p>
              <p className="text-sm text-muted">
                {report.data.rows.length} store{report.data.rows.length === 1 ? '' : 's'}
              </p>
            </Card>
            <ListCard>
              {report.data.rows.map((r) => {
                const wa = r.phone?.replace(/\D/g, '');
                const message = `Hello from ${business.businessName}. Your water balance is ${format(r.balance)}. Please pay when convenient. Thank you!`;
                return (
                  <div key={r.storeId} className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <ListRow
                        to={`/stores/${r.storeId}`}
                        title={r.storeName}
                        subtitle={r.lastPaymentAt ? `Last paid ${formatDate(r.lastPaymentAt, tz)}` : 'No payments yet'}
                        trailing={<span className="font-semibold text-bad tabular">{format(r.balance)}</span>}
                      />
                    </div>
                    {wa ? (
                      <a
                        href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Send ${r.storeName} a payment reminder on WhatsApp`}
                        className="mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-brand-700 hover:bg-brand-50"
                      >
                        <MessageCircle className="size-5" />
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </ListCard>
          </>
        )}
      </PageBody>
    </>
  );
}
