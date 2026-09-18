import { AlertCircle, ArrowRight, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { describeError } from '@/lib/errors';
import { Button } from './button';
export function ErrorNotice({
  error,
  retry,
  inline,
}: {
  error: unknown;
  retry?: () => void;
  inline?: (issue: ErrorIssue) => boolean;
}) {
  const { message, details } = describeError(error, inline);
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={19} />
      <div>
        <div>{message}</div>
        {details.length > 0 && (
          <ul className="notice-details">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {retry && (
          <Button variant="ghost" size="sm" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
export function Loading({
  label = 'Loading your workspace…',
}: {
  label?: string;
}) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      {label}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">↗</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      {value.replaceAll('-', ' ')}
    </span>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowRight size={15} />
    </Link>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 25,
  onPage,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total.toLocaleString()} records · Page {page} of{' '}
        {Math.max(1, Math.ceil(total / pageSize))}
      </span>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
