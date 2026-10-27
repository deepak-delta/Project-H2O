import { formatPhone } from '@wd/shared';
import { Bell, Boxes, Receipt, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { LogoutButton } from '../../features/auth/LogoutButton';
import { useSession } from '../../features/auth/session';
import { AddEntrySheet } from '../../features/cashflow/AddEntrySheet';

export default function StaffMorePage() {
  const { user, business } = useSession();
  const [addingExpense, setAddingExpense] = useState(false);
  return (
    <>
      <PageHeader title="More" />
      <PageBody>
        <Card className="px-4 py-3.5">
          <p className="font-semibold text-ink">{user.name}</p>
          <p className="text-sm text-muted">
            Delivery staff · {business.businessName} · {formatPhone(user.phone)}
          </p>
        </Card>
        <ListCard>
          <ListRow
            onClick={() => setAddingExpense(true)}
            title="Add expense"
            subtitle="Fuel or other spending today"
            leading={<Receipt className="size-5 text-brand-700" aria-hidden />}
          />
          <ListRow
            to="/inventory"
            title="Inventory"
            subtitle="Stock, refills, damaged or lost cans"
            leading={<Boxes className="size-5 text-brand-700" aria-hidden />}
          />
        </ListCard>
        <ListCard>
          <ListRow
            to="/settings/notifications"
            title="Notifications"
            subtitle="When an order is given to you"
            leading={<Bell className="size-5 text-brand-700" aria-hidden />}
          />
          <ListRow
            to="/settings/security"
            title="Login & security"
            subtitle="PIN, Face ID / fingerprint"
            leading={<ShieldCheck className="size-5 text-brand-700" aria-hidden />}
          />
        </ListCard>
        <LogoutButton />
      </PageBody>
      <AddEntrySheet open={addingExpense} onClose={() => setAddingExpense(false)} expenseOnly />
    </>
  );
}
