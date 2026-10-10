import type { BusinessSummary } from '@wd/shared';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { usePeriod, type PeriodPreset } from '../../components/ui/PeriodPicker';
import { Segmented } from '../../components/ui/Segmented';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { Stat } from '../../components/ui/Stat';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { downloadCsv, type CsvCell } from '../../utils/csv';
import { downloadBlob } from '../../utils/download';
import { useSession } from '../auth/session';
import { CATEGORY_LABEL, METHOD_LABEL } from '../cashflow/labels';
import { useBusinessSummary } from './api';
import { formatPeriod } from './ReportBits';
import { summaryPdf } from './summaryPdf';

// Four short choices that always fit on one line of a phone.
const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '1y', label: '1 year' },
];

/** One report with everything: sales, money, expenses, cans, staff and clients for a period. */
export default function SummaryReportPage() {
  const format = useMoney();
  const { period, setPreset } = usePeriod('1m', PERIODS.map((p) => p.value));
  const report = useBusinessSummary(period.from, period.to);
  const business = useSession().business;
  const tz = useTimezone();
  const [makingPdf, setMakingPdf] = useState(false);

  const downloadPdf = async (data: BusinessSummary) => {
    setMakingPdf(true);
    try {
      const generatedAt = new Intl.DateTimeFormat('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
      const pdf = await summaryPdf(data, { business: business.businessName, periodLabel: period.label, generatedAt, format });
      downloadBlob(`business-summary-${data.from}-to-${data.to}.pdf`, pdf);
    } catch (err) {
      console.warn('PDF failed', err);
      toast.error('The PDF could not be made. Please try again, or download the CSV.');
    } finally {
      setMakingPdf(false);
    }
  };

  return (
    <>
      <PageHeader title="Business summary" back="/reports" />
      <PageBody>
        <Segmented<PeriodPreset> label="Period" value={period.preset} onChange={setPreset} options={PERIODS} />
        <p className="-mt-2 px-1 text-sm text-muted">
          {formatPeriod(period.from)} – {formatPeriod(period.to)}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            icon={<FileText className="size-5" />}
            loading={makingPdf}
            disabled={!report.data}
            onClick={() => report.data && void downloadPdf(report.data)}
          >
            Download PDF
          </Button>
          <Button
            variant="secondary"
            icon={<FileSpreadsheet className="size-5" />}
            disabled={!report.data}
            onClick={() => report.data && exportCsv(report.data, period.label)}
          >
            Download CSV
          </Button>
        </div>

        {report.isPending ? (
          <ListSkeleton rows={8} />
        ) : report.isError ? (
          <ErrorRetry message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
        ) : (
          <Summary data={report.data} format={format} />
        )}
      </PageBody>
    </>
  );
}

function Summary({ data, format }: { data: BusinessSummary; format: (amount: string) => string }) {
  const { sales, cans, cashFlow, now } = data;
  const expenses = cashFlow.byCategory.filter((c) => c.type === 'EXPENSE');
  const quiet = sales.deliveries === 0 && sales.collected === '0.00' && cashFlow.moneyOut === '0.00';

  return (
    <>
      <section>
        <SectionTitle>This period</SectionTitle>
        <Card className="grid grid-cols-2 gap-2 p-2">
          <Stat label="Sales" value={format(sales.sales)} />
          <Stat label="Collected" value={format(sales.collected)} />
          <Stat label="Cans delivered" value={sales.cans} hint={`${sales.deliveries} ${sales.deliveries === 1 ? 'delivery' : 'deliveries'}`} />
          <Stat
            label="Change in dues"
            value={format(sales.duesChange)}
            tone={sales.duesChange.startsWith('-') ? 'default' : 'warn'}
            hint="Sales not yet paid"
          />
        </Card>
        {quiet ? <p className="mt-2 px-1 text-sm text-muted">Nothing was recorded in this period. Try a longer one.</p> : null}
      </section>

      {data.collectedByMethod.length > 0 ? (
        <Section title="Money received">
          {data.collectedByMethod.map((m) => (
            <Row key={m.method} label={METHOD_LABEL[m.method]} value={format(m.amount)} />
          ))}
        </Section>
      ) : null}

      <section>
        <SectionTitle>Cash flow</SectionTitle>
        <Card className="grid grid-cols-3 gap-2 p-2">
          <Stat label="Money in" value={format(cashFlow.moneyIn)} />
          <Stat label="Money out" value={format(cashFlow.moneyOut)} />
          <Stat label="Net" value={format(cashFlow.net)} tone={cashFlow.net.startsWith('-') ? 'bad' : 'default'} />
        </Card>
      </section>
      {expenses.length > 0 ? (
        <Section title="Expenses">
          {expenses.map((c) => (
            <Row key={c.category} label={CATEGORY_LABEL[c.category]} value={format(c.amount)} />
          ))}
        </Section>
      ) : null}

      <Section title="Cans">
        <Row label="Full cans delivered" value={cans.delivered} />
        <Row label="Empties collected" value={cans.emptiesBack} />
        {cans.damagedFromClients ? <Row label="Damaged cans taken back" value={cans.damagedFromClients} /> : null}
        {cans.damagedOrLostInStock ? <Row label="Damaged or lost in stock" value={cans.damagedOrLostInStock} /> : null}
        {cans.refilled ? <Row label="Refilled" value={cans.refilled} /> : null}
      </Section>

      <section>
        <SectionTitle>Right now</SectionTitle>
        <Card className="grid grid-cols-2 gap-2 p-2">
          <Stat
            label="Owed to you"
            value={format(now.outstanding)}
            tone={now.outstanding === '0.00' ? 'default' : 'warn'}
            hint={`${now.clientsOwing} ${now.clientsOwing === 1 ? 'client' : 'clients'}`}
            to="/reports/outstanding"
          />
          <Stat label="Cans with clients" value={now.cansWithClients} to="/inventory/holders" />
        </Card>
      </section>
      {now.stock.length > 0 ? (
        <Section title="Stock now">
          {now.stock.map((p) => (
            <ListRow
              key={p.productId}
              title={p.productName}
              subtitle={[`${p.empty} empty`, `${p.withCustomers} with clients`, p.damaged ? `${p.damaged} damaged` : null].filter(Boolean).join(' · ')}
              trailing={<span className="font-semibold tabular">{p.filled} full</span>}
            />
          ))}
        </Section>
      ) : null}

      {data.people.length > 0 ? (
        <Section title="Owner and staff">
          {data.people.map((p) => (
            <ListRow
              key={p.userId}
              title={p.role === 'SUPPLIER' ? `${p.name} (owner)` : p.name}
              subtitle={`${p.deliveries} ${p.deliveries === 1 ? 'delivery' : 'deliveries'} · ${p.cans} cans`}
              trailing={<span className="font-semibold tabular">{format(p.collected)}</span>}
            />
          ))}
        </Section>
      ) : null}

      {data.topClients.length > 0 ? (
        <Section title="Top clients">
          {data.topClients.map((c) => (
            <ListRow
              key={c.storeId}
              to={`/stores/${c.storeId}`}
              title={c.storeName}
              subtitle={`Paid ${format(c.collected)}`}
              trailing={<span className="font-semibold tabular">{format(c.sales)}</span>}
            />
          ))}
        </Section>
      ) : null}

      {data.topOwing.length > 0 ? (
        <Section title="Owe you the most">
          {data.topOwing.map((c) => (
            <ListRow
              key={c.storeId}
              to={`/stores/${c.storeId}`}
              title={c.storeName}
              trailing={<span className="font-semibold text-warn tabular">{format(c.balance)}</span>}
            />
          ))}
        </Section>
      ) : null}

      <p className="px-1 text-sm text-muted">
        {data.newClients} new {data.newClients === 1 ? 'client' : 'clients'} in this period. "Right now" and "Stock now" are today's figures.
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ListCard>{children}</ListCard>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <ListRow title={label} trailing={<span className="font-semibold tabular">{value}</span>} />;
}

/** The whole summary as one spreadsheet: a section column keeps it readable and sortable. */
function exportCsv(d: BusinessSummary, label: string) {
  const rows: CsvCell[][] = [
    ['Period', label, `${d.from} to ${d.to}`],
    ['Sales', 'Sales', d.sales.sales],
    ['Sales', 'Collected', d.sales.collected],
    ['Sales', 'Change in dues', d.sales.duesChange],
    ['Sales', 'Deliveries', d.sales.deliveries],
    ['Sales', 'Cans delivered', d.sales.cans],
    ...d.collectedByMethod.map((m): CsvCell[] => ['Money received', METHOD_LABEL[m.method], m.amount]),
    ['Cash flow', 'Money in', d.cashFlow.moneyIn],
    ['Cash flow', 'Money out', d.cashFlow.moneyOut],
    ['Cash flow', 'Net', d.cashFlow.net],
    ...d.cashFlow.byCategory.map((c): CsvCell[] => [c.type === 'EXPENSE' ? 'Expenses' : 'Income', CATEGORY_LABEL[c.category], c.amount]),
    ['Cans', 'Full cans delivered', d.cans.delivered],
    ['Cans', 'Empties collected', d.cans.emptiesBack],
    ['Cans', 'Damaged cans taken back', d.cans.damagedFromClients],
    ['Cans', 'Damaged or lost in stock', d.cans.damagedOrLostInStock],
    ['Cans', 'Refilled', d.cans.refilled],
    ['Clients', 'New clients', d.newClients],
    ['Right now', 'Owed to you', d.now.outstanding],
    ['Right now', 'Clients owing', d.now.clientsOwing],
    ['Right now', 'Cans with clients', d.now.cansWithClients],
    ...d.now.stock.map((p): CsvCell[] => ['Stock now', p.productName, p.filled, `${p.empty} empty, ${p.withCustomers} with clients, ${p.damaged} damaged`]),
    ...d.people.map((p): CsvCell[] => [
      p.role === 'SUPPLIER' ? 'Owner' : 'Staff',
      p.name,
      p.collected,
      `${p.deliveries} deliveries, ${p.cans} cans`,
    ]),
    ...d.topClients.map((c): CsvCell[] => ['Top clients', c.storeName, c.sales, `paid ${c.collected}`]),
    ...d.topOwing.map((c): CsvCell[] => ['Owe you the most', c.storeName, c.balance]),
  ];
  downloadCsv(`business-summary-${d.from}-to-${d.to}.csv`, ['Section', 'Item', 'Value', 'Detail'], rows);
}
