import { useSearchParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Segmented';
import { BalanceText } from '../../components/ui/Stat';
import { useMoney } from '../../hooks/useMoney';
import { useSession } from '../auth/session';
import { CanHistory, MoneyHistory } from '../stores/StoreDetailPage';
import { useStoreHome } from './api';

/** The store's own account statement: every bill and payment with a running balance. */
export default function StatementPage() {
  const { user } = useSession();
  const storeId = user.storeId ?? '';
  const home = useStoreHome();
  const format = useMoney();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'cans' ? 'cans' : 'money';

  return (
    <>
      <PageHeader title="Statement" back="/" />
      <PageBody>
        {home.data ? (
          <Card className="grid grid-cols-2 gap-3 p-4">
            <div>
              <p className="text-[13px] text-muted">Balance</p>
              <p className="mt-0.5 text-xl">
                <BalanceText balance={home.data.balance} format={format} />
              </p>
            </div>
            <div>
              <p className="text-[13px] text-muted">Cans with you</p>
              <p className="mt-0.5 text-xl font-semibold tabular">{home.data.cansOutstanding}</p>
            </div>
          </Card>
        ) : null}
        <Segmented
          label="Statement"
          value={tab}
          onChange={(v) => setParams(v === 'cans' ? { tab: 'cans' } : {}, { replace: true })}
          options={[
            { value: 'money', label: 'Money' },
            { value: 'cans', label: 'Cans' },
          ]}
        />
        {tab === 'money' ? <MoneyHistory storeId={storeId} /> : <CanHistory storeId={storeId} />}
      </PageBody>
    </>
  );
}
