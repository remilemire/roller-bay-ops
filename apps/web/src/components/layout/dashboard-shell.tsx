'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  CalendarDays,
  Factory,
  Layers3,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  PackagePlus,
  Scissors,
  Settings2,
  Users,
} from 'lucide-react';
import { api, noContent } from '@/lib/api';
import {
  useCanManage,
  useCurrentUser,
  clearPrivateData,
  sessionKey,
} from '@/features/auth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { Breadcrumbs, PageTitleContext } from './breadcrumbs';
import { ThemeSwitch } from './theme-switch';
const navigation = [
  { href: '/', label: 'Overview', Icon: LayoutDashboard },
  { href: '/stock-items', label: 'Fabric stock', Icon: Layers3 },
  { href: '/stock-receipts', label: 'Stock receipts', Icon: PackagePlus },
  { href: '/work-orders', label: 'Work orders', Icon: CalendarDays },
  { href: '/allocations', label: 'Allocations', Icon: Scissors },
  { href: '/stations', label: 'Stations', Icon: Factory },
  { href: '/fabric-catalog', label: 'Fabric catalog', Icon: Box },
  { href: '/locations', label: 'Locations', Icon: MapPin },
  { href: '/users', label: 'Users', Icon: Users, manageOnly: true },
];
const sections = [...navigation, { href: '/settings', label: 'Settings' }];
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const canManage = useCanManage();
  const productionOnly = user.role === 'production';
  const accessPending = user.role === 'pending';
  const stationRoute =
    pathname === '/stations' ||
    pathname.startsWith('/stations/cutting/') ||
    pathname === '/settings';
  useEffect(() => {
    if (productionOnly && !stationRoute) router.replace('/stations');
  }, [productionOnly, stationRoute, router]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', noContent, { method: 'POST' }),
    onSuccess: async () => {
      await client.cancelQueries();
      client.setQueryData(sessionKey, null);
      await clearPrivateData(client);
      router.replace('/login');
    },
  });
  if (accessPending)
    return (
      <main className="login-page">
        <section className="login-panel glass">
          <div className="brand-symbol">
            <Layers3 size={27} />
          </div>
          <div className="eyebrow">ROLLER BAY · OPERATIONS</div>
          <h1>Access pending</h1>
          <p>
            Your account is ready, but an administrator still needs to assign
            your workspace access.
          </p>
          {logout.error && <ErrorNotice error={logout.error} />}
          <Button
            variant="outline"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut size={17} />
            Sign out
          </Button>
        </section>
      </main>
    );
  if (productionOnly && !stationRoute) return <p>Opening station…</p>;
  const nav = (
    <>
      <Link
        href={productionOnly ? '/stations' : '/'}
        className="brand"
        onClick={() => setMobileOpen(false)}
      >
        <span className="brand-symbol">
          <Layers3 size={23} />
        </span>
        <span>
          roller bay<span className="brand-caption">OPERATIONS</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        {navigation
          .filter((item) =>
            productionOnly
              ? item.href === '/stations'
              : !item.manageOnly || canManage,
          )
          .map(({ href, label, Icon }) => {
            const active =
              href === '/' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                href={href}
                key={href}
                className={`nav-link ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={20} />
                <span>{label}</span>
                {active && <span className="nav-dot" />}
              </Link>
            );
          })}
      </nav>
      <div className="sidebar-bottom">
        <Link
          className={`nav-link ${pathname === '/settings' ? 'active' : ''}`}
          href="/settings"
          onClick={() => setMobileOpen(false)}
        >
          <Settings2 size={20} />
          Settings
        </Link>
        <button
          className="user-card"
          type="button"
          onClick={() => {
            setMobileOpen(false);
            setSignOutOpen(true);
          }}
          aria-label={`Account options for ${user.name}`}
        >
          <span className="avatar">
            {user.name
              .split(' ')
              .map((s) => s[0])
              .slice(0, 2)
              .join('')}
          </span>
          <span>
            <strong>{user.name}</strong>
            <small>{user.role === 'staff' ? 'Staff' : user.role}</small>
          </span>
          <LogOut size={17} />
        </button>
      </div>
    </>
  );
  return (
    <div className="workspace">
      <a href="#workspace-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar glass">{nav}</aside>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen} title="Navigation">
        <div className="mobile-nav">{nav}</div>
      </Dialog>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-title">
            <Button
              variant="ghost"
              size="icon"
              className="menu-button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </Button>
            <Breadcrumbs sections={sections} title={pageTitle} />
          </div>
          <div className="topbar-actions">
            <ThemeSwitch />
          </div>
        </header>
        <main id="workspace-content" className="workspace-content">
          <PageTitleContext value={setPageTitle}>{children}</PageTitleContext>
        </main>
      </div>
      <Dialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title={user.name}
        description={user.email}
      >
        <p className="muted">
          Signing out closes this session. Save any unfinished work as a draft
          first.
        </p>
        {logout.error && <ErrorNotice error={logout.error} />}
        <div className="form-actions">
          <Button variant="outline" onClick={() => setSignOutOpen(false)}>
            Stay signed in
          </Button>
          <Button disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut size={17} />
            Sign out
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
