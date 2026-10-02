import { addDays, startOfMonth, zonedDateKey } from '@wd/shared';
import { useSearchParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { PeriodChips, usePeriod } from '../../components/ui/PeriodPicker';
import { Segmented } from '../../components/ui/Segmented';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { Stat } from '../../components/ui/Stat';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { useSalesReport } from './api';
import { CsvButton, formatPeriod } from './ReportBits';

export default function SalesReportPage() {
  const [params, setParams] = useSearchParams();
  const groupBy = params.get('groupBy') === 'month' ? 'month' : 'day';
  const tz = useTimezone();
  const format = useMoney();
  const { period, setPreset, allowed } = usePeriod('7d', ['7d', 'month', 'lastMonth']);

  // Monthly view always covers the last 12 months.
  const today = zonedDateKey(new Date(), tz);
  let monthsFrom = startOfMonth(today);
  for (let i = 0; i < 11; i++) monthsFrom = startOfMonth(addDays(monthsFrom, -1));
  const from = groupBy === 'month' ? monthsFrom : period.from;
  const to = groupBy === 'month' ? today : period.to;
  const report = useSalesReport(from, to, groupBy);

  const exportCsv = () =>
    report.data &&
    downloadCsv(
      `sales-${groupBy}-${from}-to-${to}.csv`,
      [groupBy === 'day' ? 'Date' : 'Month', 'Deliveries', 'Cans delivered', 'Sales', 'Collected', 'Change in dues'],
      report.data.rows.map((r) => [r.period, r.deliveries, r.cans, r.sales, r.collected, r.duesChange]),
    );

  return (
    <>
      <PageHeader
        title={groupBy === 'day' ? 'Daily sales' : 'Monthly sales'}
        back="/reports"
        action={<CsvButton onClick={exportCsv} disabled={!report.data} />}
      />
      <PageBody>
        <Segmented
          label="Group by"
          value={groupBy}
          onChange={(v) => setParams(v === 'month' ? { groupBy: 'month' } : {}, { replace: true })}
          options={[
            { value: 'day', label: 'By day' },
            { value: 'month', label: 'By month' },
          ]}
        />
        {groupBy === 'day' ? <PeriodChips value={period.preset} onChange={setPreset} allowed={allowed} /> : null}

        {report.isPending ? (
          <ListSkeleton rows={6} />
        ) : report.isError ? (
          <ErrorRetry message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
        ) : (
          <>
            <Card className="grid grid-cols-2 gap-2 p-2">
              <Stat label="Sales" value={format(report.data.totals.sales)} />
              <Stat label="Collected" value={format(report.data.totals.collected)} />
              <Stat label="Cans delivered" value={report.data.totals.cans} hint={`${report.data.totals.deliveries} ${report.data.totals.deliveries === 1 ? 'delivery' : 'deliveries'}`} />
              <Stat
                label="Change in dues"
                value={format(report.data.totals.duesChange)}
                tone={report.data.totals.duesChange.startsWith('-') ? 'default' : 'warn'}
                hint="Sales not yet paid"
              />
            </Card>
            <ListCard>
              {[...report.data.rows].reverse().map((r) => (
                <ListRow
                  key={r.period}
                  title={formatPeriod(r.period)}
                  subtitle={`${r.cans} cans · collected ${format(r.collected)}`}
                  trailing={<span className={`font-semibold tabular ${r.sales === '0.00' ? 'text-muted' : 'text-ink'}`}>{format(r.sales)}</span>}
                />
              ))}
            </ListCard>
          </>
        )}
      </PageBody>
    </>
  );
}
