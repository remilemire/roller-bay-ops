'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MouseEvent,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Lets the page's heading name the last crumb; a no-op outside the shell. */
export const PageTitleContext = createContext<(title: string | null) => void>(
  () => {},
);
export function usePageTitle(title: string) {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}

type Section = { href: string; label: string };
type Crumb = { href?: string; label: string };

export function breadcrumbTrail(
  pathname: string,
  sections: Section[],
  title: string | null,
): Crumb[] {
  const section = sections.find(
    (s) => s.href !== '/' && pathname.startsWith(s.href),
  );
  if (!section) return [{ label: 'Overview' }];
  const [record, child] = pathname.slice(section.href.length + 1).split('/');
  if (!record) return [{ label: section.label }];
  if (child === 'cutting-sheet')
    return [
      section,
      { href: `${section.href}/${record}`, label: title ?? 'Allocation' },
      { label: 'Cutting sheet' },
    ];
  // The record's name arrives with its data; until then the trail ends early.
  return title ? [section, { label: title }] : [section];
}

export function Breadcrumbs({
  sections,
  title,
}: {
  sections: Section[];
  title: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const entry = useRef(pathname);
  const navigated = useRef(false);
  useEffect(() => {
    if (pathname !== entry.current) navigated.current = true;
  }, [pathname]);
  const trail = breadcrumbTrail(pathname, sections, title);
  const parent = trail.findLast((crumb) => crumb.href)?.href;
  // A real link, so the unsaved-changes prompt sees the click first. History
  // keeps the previous page's filters; a page opened directly has none, so the
  // link's parent page stands in.
  const back = (event: MouseEvent) => {
    if (
      !navigated.current ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    router.back();
  };
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {parent && (
        <Button asChild variant="ghost" size="icon">
          <Link href={parent} aria-label="Back" onClick={back}>
            <ArrowLeft size={18} />
          </Link>
        </Button>
      )}
      <ol>
        {trail.map((crumb, index) => (
          <li key={index}>
            {index > 0 && <ChevronRight size={14} aria-hidden />}
            {crumb.href ? (
              <Link href={crumb.href}>{crumb.label}</Link>
            ) : (
              <strong aria-current="page">{crumb.label}</strong>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
