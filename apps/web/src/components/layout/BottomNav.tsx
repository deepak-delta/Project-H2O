import type { Role } from '@wd/shared';
import {
  ClipboardList,
  Ellipsis,
  House,
  Plus,
  Receipt,
  Store,
  User,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router';
import { cn } from '../../utils/cn';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Screens opened from this tab, so it stays highlighted there too. */
  activeFor?: string[];
}

const SUPPLIER_LEFT: NavItem[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
];
// Two tabs either side keeps "New order" in the exact centre; Inventory lives under More
// (and the dashboard's Cans card links straight to it).
const SUPPLIER_RIGHT: NavItem[] = [
  { to: '/stores', label: 'Clients', icon: Store },
  {
    to: '/more',
    label: 'More',
    icon: Ellipsis,
    activeFor: ['/inventory', '/reports', '/payments', '/cashflow', '/products', '/settings', '/staff'],
  },
];
// Delivery staff: same centred "+" (new delivery); everything else is about today.
const STAFF_LEFT: NavItem[] = [
  { to: '/', label: 'Today', icon: House },
  { to: '/stores', label: 'Clients', icon: Store },
];
const STAFF_RIGHT: NavItem[] = [
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/more', label: 'More', icon: Ellipsis, activeFor: ['/settings'] },
];
const STORE_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/payments', label: 'Payments', icon: Wallet },
  { to: '/account', label: 'Account', icon: User },
];

function Tab({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const viaChild = item.activeFor?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive: onTab }) => {
        const isActive = onTab || viaChild;
        return cn(
          'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
          'lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-[15px]',
          isActive ? 'text-brand-700 lg:bg-brand-50' : 'text-muted hover:text-ink-2',
        );
      }}
    >
      {({ isActive }) => (
        <>
          <Icon className="size-6 lg:size-5" strokeWidth={isActive || viaChild ? 2.25 : 1.75} aria-hidden />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Bottom tab bar on phones (thumb reach), left rail on large screens.
 * Suppliers get a raised "New order" button in the middle — the most frequent action.
 */
export function BottomNav({ role }: { role: Role }) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-safe backdrop-blur-sm',
        'lg:inset-y-0 lg:right-auto lg:w-60 lg:border-t-0 lg:border-r lg:pt-6 lg:pb-6',
      )}
    >
      <div className="mx-auto flex max-w-xl items-stretch px-1 lg:h-full lg:max-w-none lg:flex-col lg:gap-1 lg:px-3">
        <p className="hidden px-3 pb-4 text-lg font-semibold text-brand-700 lg:order-[-2] lg:block">Water Delivery</p>
        {role === 'SUPPLIER' || role === 'STAFF' ? (
          <>
            {(role === 'STAFF' ? STAFF_LEFT : SUPPLIER_LEFT).map((item) => (
              <Tab key={item.to} item={item} />
            ))}
            <div className="flex flex-1 items-center justify-center lg:order-[-1] lg:mb-3 lg:flex-none">
              <Link
                to="/orders/new"
                aria-label={role === 'STAFF' ? 'New delivery' : 'New order'}
                className={cn(
                  'flex size-13 -translate-y-3 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-md shadow-brand-700/25',
                  'transition-colors hover:bg-brand-800 active:bg-brand-800',
                  'lg:h-11 lg:w-full lg:translate-y-0 lg:gap-2 lg:rounded-xl lg:shadow-none',
                )}
              >
                <Plus className="size-7 lg:size-5" strokeWidth={2.25} aria-hidden />
                <span className="hidden font-semibold lg:inline">{role === 'STAFF' ? 'New delivery' : 'New order'}</span>
              </Link>
            </div>
            {(role === 'STAFF' ? STAFF_RIGHT : SUPPLIER_RIGHT).map((item) => (
              <Tab key={item.to} item={item} />
            ))}
          </>
        ) : (
          STORE_ITEMS.map((item) => <Tab key={item.to} item={item} />)
        )}
      </div>
    </nav>
  );
}
