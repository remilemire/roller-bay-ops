import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Breadcrumbs, breadcrumbTrail } from './breadcrumbs';

const nav = vi.hoisted(() => ({ pathname: '/', back: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: nav.back }),
}));
const sections = [
  { href: '/', label: 'Overview' },
  { href: '/allocations', label: 'Allocations' },
];
afterEach(() => {
  cleanup();
  nav.back.mockClear();
});

describe('breadcrumbTrail', () => {
  it('names only the section on a top-level page', () => {
    expect(breadcrumbTrail('/', sections, 'Overview')).toEqual([
      { label: 'Overview' },
    ]);
    expect(breadcrumbTrail('/allocations', sections, 'Allocations')).toEqual([
      { label: 'Allocations' },
    ]);
  });
  it('links the section and ends on the page title', () => {
    expect(breadcrumbTrail('/allocations/a1', sections, '40021')).toEqual([
      sections[1],
      { label: '40021' },
    ]);
    expect(breadcrumbTrail('/allocations/a1', sections, null)).toEqual([
      sections[1],
    ]);
  });
  it('links the allocation from its cutting sheet', () => {
    expect(
      breadcrumbTrail('/allocations/a1/cutting-sheet', sections, '40021'),
    ).toEqual([
      sections[1],
      { href: '/allocations/a1', label: '40021' },
      { label: 'Cutting sheet' },
    ]);
  });
});

describe('Breadcrumbs', () => {
  it('has no back button on a top-level page', () => {
    nav.pathname = '/allocations';
    render(<Breadcrumbs sections={sections} title="Allocations" />);
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });
  it('goes back through history only after navigating within the app', () => {
    nav.pathname = '/allocations';
    const view = render(<Breadcrumbs sections={sections} title={null} />);
    nav.pathname = '/allocations/a1';
    view.rerender(<Breadcrumbs sections={sections} title="40021" />);
    const back = screen.getByRole('link', { name: 'Back' });
    expect(back.getAttribute('href')).toBe('/allocations');
    fireEvent.click(back);
    expect(nav.back).toHaveBeenCalledOnce();
  });
  it('leaves a directly opened page to the parent link', () => {
    nav.pathname = '/allocations/a1';
    render(<Breadcrumbs sections={sections} title="40021" />);
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(nav.back).not.toHaveBeenCalled();
  });
});
