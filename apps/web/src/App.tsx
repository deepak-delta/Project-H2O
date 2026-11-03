import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { CircleAlert, WifiOff } from 'lucide-react';
import { QaBadge } from './components/layout/QaBadge';
import { VercelInsights } from './components/layout/VercelInsights';
import { lazy, Suspense, type ReactElement, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { OfflineBanner, Toaster, UpdatePrompt } from './components/layout/StatusBanners';
import { InstallPrompt } from './pwa/InstallPrompt';
import { Button } from './components/ui/Button';
import { PageSpinner } from './components/ui/Spinner';
import { meQueryKey, SessionContext, useMe, useSession } from './features/auth/session';
import { isNative } from './native/platform';
import { queryPersister } from './offline/storage';
import { ApiError, setUnauthenticatedHandler } from './services/api';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const SignupPage = lazy(() => import('./features/auth/SignupPage'));
const ForgotPinPage = lazy(() => import('./features/auth/ForgotPinPage'));
const SecurityPage = lazy(() => import('./features/settings/SecurityPage'));
const RecoverySetupPage = lazy(() => import('./features/settings/RecoverySetupPage'));
const MorePage = lazy(() => import('./pages/MorePage'));
const SupplierHomePage = lazy(() => import('./pages/supplier/HomePage'));
const NewOrderPage = lazy(() => import('./features/orders/NewOrderPage'));
const OrdersPage = lazy(() => import('./features/orders/OrdersPage'));
const OrderDetailPage = lazy(() => import('./features/orders/OrderDetailPage'));
const StoresPage = lazy(() => import('./features/stores/StoresPage'));
const StoreFormPage = lazy(() => import('./features/stores/StoreFormPage'));
const StoreDetailPage = lazy(() => import('./features/stores/StoreDetailPage'));
const SchedulePage = lazy(() => import('./features/schedules/SchedulePage'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'));
const HoldersPage = lazy(() => import('./features/inventory/HoldersPage'));
const ProductsPage = lazy(() => import('./features/catalog/ProductsPage'));
const PaymentsPage = lazy(() => import('./features/payments/PaymentsPage'));
const DeliverOrderPage = lazy(() => import('./features/orders/DeliverOrderPage'));
const OrderWaterPage = lazy(() => import('./features/store-app/OrderWaterPage'));
const StatementPage = lazy(() => import('./features/store-app/StatementPage'));
const CashFlowPage = lazy(() => import('./features/cashflow/CashFlowPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const SalesReportPage = lazy(() => import('./features/reports/SalesReportPage'));
const SummaryReportPage = lazy(() => import('./features/reports/SummaryReportPage'));
const OutstandingReportPage = lazy(() => import('./features/reports/OutstandingReportPage'));
const InventoryReportPage = lazy(() => import('./features/reports/InventoryReportPage'));
const PaymentsReportPage = lazy(() => import('./features/reports/PaymentsReportPage'));
const StoreHomePage = lazy(() => import('./pages/store/HomePage'));
const AccountPage = lazy(() => import('./pages/store/AccountPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
/** Only inside the Android app; never part of the browser download. */
const ShellUpdate = isNative() ? lazy(() => import('./native/ShellUpdate')) : null;
const SyncPage = lazy(() => import('./features/offline/SyncPage'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const StaffHomePage = lazy(() => import('./pages/staff/HomePage'));
const StaffMorePage = lazy(() => import('./pages/staff/MorePage'));
const StaffExpensesPage = lazy(() => import('./pages/staff/ExpensesPage'));
const StaffPage = lazy(() => import('./features/staff/StaffPage'));
const StaffDayPage = lazy(() => import('./features/staff/StaffDayPage'));

/** Data kept on the phone for offline use: needed to open the app and record deliveries. */
const OFFLINE_QUERY_ROOTS = new Set(['me', 'products', 'stores', 'orders', 'store-home', 'dashboard', 'inventory', 'payments', 'staff']);
const OFFLINE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      // Kept in memory as long as it is kept on disk, so restored data isn't thrown away.
      gcTime: OFFLINE_MAX_AGE_MS,
      // Retry only transient failures; a 4xx will not fix itself.
      retry: (count, err) => count < 2 && (!(err instanceof ApiError) || err.status === 0 || err.status >= 500),
    },
    // Never auto-retry writes. Writes that can wait for a connection go through the offline
    // outbox instead; everything else fails fast with a clear message rather than hanging.
    mutations: { retry: false, networkMode: 'always' },
  },
});

setUnauthenticatedHandler(() => {
  queryClient.setQueryData(meQueryKey, null);
});

function SessionGate({ children, mode }: { children: ReactElement; mode: 'private' | 'public' }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending && me.fetchStatus === 'paused') return <OfflineFirstRun />;
  if (me.isPending) return <PageSpinner />;
  // With a saved session the app keeps working offline even if the check failed.
  if (me.isError && !me.data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <CircleAlert className="size-8 text-muted" aria-hidden />
        <p className="font-semibold text-ink">Can't reach the server</p>
        <p className="text-sm text-muted">Check your internet connection and try again.</p>
        <Button onClick={() => void me.refetch()} loading={me.isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (mode === 'private') {
    if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <SessionContext.Provider value={me.data}>{children}</SessionContext.Provider>;
  }
  if (me.data) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return children;
}

/** First launch with no connection and nothing saved on this phone yet. */
function OfflineFirstRun() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <WifiOff className="size-8 text-muted" aria-hidden />
      <p className="font-semibold text-ink">You're offline</p>
      <p className="max-w-xs text-sm text-muted">Connect to the internet once to log in. After that the app works without a connection.</p>
    </div>
  );
}

/**
 * Renders the screen for the signed-in role; any role not listed gets a 404 (routes are
 * role-scoped). Staff must be listed explicitly: they never fall through to another role's screen.
 */
function ByRole({ supplier, store, staff }: { supplier?: ReactNode; store?: ReactNode; staff?: ReactNode }) {
  const { user } = useSession();
  const element = user.role === 'SUPPLIER' ? supplier : user.role === 'STORE' ? store : user.role === 'STAFF' ? staff : undefined;
  return <>{element ?? <NotFoundPage />}</>;
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <SessionGate mode="public">
        <Suspense fallback={<PageSpinner />}>
          <LoginPage />
        </Suspense>
      </SessionGate>
    ),
  },
  {
    path: '/forgot-pin',
    element: (
      <SessionGate mode="public">
        <Suspense fallback={<PageSpinner />}>
          <ForgotPinPage />
        </Suspense>
      </SessionGate>
    ),
  },
  {
    path: '/signup',
    element: (
      <SessionGate mode="public">
        <Suspense fallback={<PageSpinner />}>
          <SignupPage />
        </Suspense>
      </SessionGate>
    ),
  },
  {
    path: '/',
    element: (
      <SessionGate mode="private">
        <Outlet />
      </SessionGate>
    ),
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <ByRole supplier={<SupplierHomePage />} store={<StoreHomePage />} staff={<StaffHomePage />} /> },
          { path: 'orders', element: <ByRole supplier={<OrdersPage />} store={<OrdersPage />} staff={<Navigate to="/" replace />} /> },
          { path: 'orders/:id', element: <ByRole supplier={<OrderDetailPage />} store={<OrderDetailPage />} staff={<OrderDetailPage />} /> },
          { path: 'stores', element: <ByRole supplier={<StoresPage />} staff={<StoresPage />} /> },
          { path: 'stores/new', element: <ByRole supplier={<StoreFormPage />} /> },
          { path: 'stores/:id', element: <ByRole supplier={<StoreDetailPage />} staff={<StoreDetailPage />} /> },
          { path: 'stores/:id/edit', element: <ByRole supplier={<StoreFormPage />} /> },
          { path: 'inventory', element: <ByRole supplier={<InventoryPage />} staff={<InventoryPage />} /> },
          { path: 'inventory/holders', element: <ByRole supplier={<HoldersPage />} staff={<HoldersPage />} /> },
          { path: 'more', element: <ByRole supplier={<MorePage />} staff={<StaffMorePage />} /> },
          { path: 'staff', element: <ByRole supplier={<StaffPage />} /> },
          { path: 'expenses', element: <ByRole staff={<StaffExpensesPage />} /> },
          { path: 'staff/:id', element: <ByRole supplier={<StaffDayPage />} /> },
          { path: 'payments', element: <ByRole supplier={<PaymentsPage />} store={<PaymentsPage />} /> },
          { path: 'cashflow', element: <ByRole supplier={<CashFlowPage />} /> },
          { path: 'reports', element: <ByRole supplier={<ReportsPage />} /> },
          { path: 'reports/summary', element: <ByRole supplier={<SummaryReportPage />} /> },
          { path: 'reports/sales', element: <ByRole supplier={<SalesReportPage />} /> },
          { path: 'reports/outstanding', element: <ByRole supplier={<OutstandingReportPage />} /> },
          { path: 'reports/inventory', element: <ByRole supplier={<InventoryReportPage />} /> },
          { path: 'reports/payments', element: <ByRole supplier={<PaymentsReportPage />} /> },
          { path: 'products', element: <ByRole supplier={<ProductsPage />} /> },
          { path: 'account', element: <ByRole store={<AccountPage />} /> },
          { path: 'statement', element: <ByRole store={<StatementPage />} /> },
          { path: 'settings/security', element: <SecurityPage /> },
          { path: 'settings/recovery', element: <RecoverySetupPage /> },
          { path: 'sync', element: <SyncPage /> },
          { path: 'settings/notifications', element: <NotificationsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        // Focused flows: no bottom nav, the page owns its sticky action bar.
        element: <AppShell nav={false} />,
        children: [
          { path: 'orders/new', element: <ByRole supplier={<NewOrderPage />} store={<OrderWaterPage />} staff={<NewOrderPage />} /> },
          { path: 'orders/:id/deliver', element: <ByRole supplier={<DeliverOrderPage />} staff={<DeliverOrderPage />} /> },
          { path: 'stores/:id/schedule', element: <ByRole supplier={<SchedulePage />} /> },
        ],
      },
    ],
  },
]);

if (isNative()) {
  void import('./native/bootstrap').then(({ startNative }) => startNative((path) => void router.navigate(path)));
}

export function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: OFFLINE_MAX_AGE_MS,
        buster: 'v1',
        dehydrateOptions: {
          // A signed-out state (me = null) is never saved, so reopening can't log someone out.
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && q.state.data != null && OFFLINE_QUERY_ROOTS.has(String(q.queryKey[0])),
        },
      }}
      // Restored data may be out of date (e.g. a sale was recorded just before the app closed):
      // show it immediately, but re-check everything in the background when online.
      onSuccess={() => void queryClient.invalidateQueries()}
    >
      <QaBadge />
      <VercelInsights />
      <OfflineBanner />
      <RouterProvider router={router} />
      <Toaster />
      <UpdatePrompt />
      <InstallPrompt />
      {ShellUpdate ? (
        <Suspense fallback={null}>
          <ShellUpdate />
        </Suspense>
      ) : null}
    </PersistQueryClientProvider>
  );
}
