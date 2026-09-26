/**
 * Turns anything thrown on the client into copy an operator can act on. Only
 * the API's curated message and field issues, or a shared validation schema's
 * issues, reach the screen; text from any other exception is replaced.
 */
import { z } from 'zod';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { ApiError } from './api';

export const GENERIC_ERROR_MESSAGE =
  'Something went wrong. Your changes have not been discarded. Please try again.';
export const INVALID_FIELDS_MESSAGE = 'Some fields are missing or invalid.';
const MAX_DETAILS = 8;

/**
 * `inline` names the issues a form already shows beside their fields, so the
 * notice lists only what has no field of its own.
 */
export function describeError(
  error: unknown,
  inline: (issue: ErrorIssue) => boolean = () => false,
): {
  message: string;
  details: string[];
} {
  const details = describeIssues(
    errorIssues(error).filter((issue) => !inline(issue)),
  );
  if (error instanceof z.ZodError)
    return { message: INVALID_FIELDS_MESSAGE, details };
  if (error instanceof ApiError) return { message: error.message, details };
  return { message: GENERIC_ERROR_MESSAGE, details: [] };
}

export function errorIssues(error: unknown): ErrorIssue[] {
  if (error instanceof z.ZodError)
    return error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    }));
  return error instanceof ApiError ? error.issues : [];
}

/** The issue's path as `plan.cuts.0.stockItemId`, whichever shape it came in. */
export const issuePath = (issue: ErrorIssue) =>
  typeof issue.path === 'string' ? issue.path : (issue.path ?? []).join('.');

/** Copy for an issue shown beside its field, where the label is redundant. */
export function describeFieldIssue(issue: ErrorIssue): string {
  const predicate = describePredicate(issue)?.replace(/^(is|has) /, '');
  return predicate
    ? `${predicate.charAt(0).toUpperCase()}${predicate.slice(1)}.`
    : issue.message;
}

export function describeIssues(issues: readonly ErrorIssue[]): string[] {
  const lines = [...new Set(issues.map(describeIssue))];
  return lines.length <= MAX_DETAILS
    ? lines
    : [
        ...lines.slice(0, MAX_DETAILS),
        `…and ${lines.length - MAX_DETAILS} more.`,
      ];
}

export function describeIssue(issue: ErrorIssue): string {
  const label = describeIssuePath(issue.path);
  const predicate = describePredicate(issue);
  if (!label) return predicate ? `This value ${predicate}.` : issue.message;
  return predicate ? `${label} ${predicate}.` : `${label}: ${issue.message}`;
}

const INDEX = /^\d+$/;
// Rows are named by position, or by ID in the plan validator's context.
const ROW = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27})$/i;
// Payload names that differ from what the screens call them.
const TERMS: Record<string, string> = {
  requirement: 'blind',
  requirements: 'blinds',
};

/** `plan.cuts.0.items.1.widthMm` becomes `Cut 1 › item 2 › width`. */
export function describeIssuePath(path: ErrorIssue['path']): string {
  const segments = pathSegments(path);
  const parts: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const next = segments[index + 1];
    if (ROW.test(segment)) {
      if (INDEX.test(segment)) parts.push(ordinal(segment));
      continue;
    }
    const label = words(segment);
    if (next !== undefined && ROW.test(next)) {
      parts.push(
        INDEX.test(next)
          ? `${singular(label)} ${ordinal(next)}`
          : singular(label),
      );
      index++;
    } else parts.push(label);
  }
  const text = parts.join(' › ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pathSegments(path: ErrorIssue['path']): string[] {
  const segments = (typeof path === 'string' ? path.split('.') : (path ?? []))
    .map(String)
    .filter((segment) => segment !== '');
  // A leading "context" names the validator's stock snapshot and "data" a
  // draft's payload, not form sections; "plan" adds nothing to its cuts.
  let start = 0;
  while (
    start < segments.length - 1 &&
    ['context', 'data', 'plan'].includes(segments[start]!)
  )
    start++;
  return segments.slice(start);
}

const ordinal = (segment: string) => String(Number(segment) + 1);
const words = (segment: string) => {
  const label = segment
    .replace(/Mm2?$/, '')
    .replace(/([a-z0-9])Id(s?)$/, '$1$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return TERMS[label] ?? label;
};
const singular = (label: string) =>
  label.length > 3 && label.endsWith('s') && !label.endsWith('ss')
    ? label.slice(0, -1)
    : label;

// Zod's default messages describe types and bounds; custom messages are
// already sentences and pass through unchanged.
function describePredicate(issue: ErrorIssue): string | null {
  const message = issue.message.trim();
  if (issue.code === 'invalid_type' || /^Invalid input: expected/.test(message))
    return /received (null|undefined)$/.test(message)
      ? 'is required'
      : 'is invalid';
  // A choice left unselected fails the payload's discriminator, and an ID
  // left unpicked fails its format: forms only send IDs chosen from a list.
  if (/^Invalid (discriminator value|UUID)/.test(message)) return 'is required';
  const bound = message.match(BOUND);
  if (bound) return describeBound(issue, bound);
  if (/^Too small/.test(message)) return 'is too small';
  if (/^Too big/.test(message)) return 'is too large';
  if (/^Invalid number: must be a multiple of/.test(message))
    return 'has too many decimal places';
  if (/^Invalid (input|string|ISO)/.test(message)) return 'is invalid';
  return null;
}

// "Too small: expected string to have >=1 characters"
const BOUND =
  /^Too (small|big): expected (\w+) to (?:have|be) ([<>]=?)(-?[\d.]+)/;

function describeBound(
  issue: ErrorIssue,
  [, size, origin, operator, value]: RegExpMatchArray,
): string {
  const limit = Number(value);
  const small = size === 'small';
  const inclusive = operator!.endsWith('=');
  if (origin === 'string')
    return small
      ? limit <= 1
        ? 'is required'
        : `must be at least ${limit} characters`
      : `must be ${inclusive ? limit : limit - 1} characters or fewer`;
  if (origin === 'array')
    return small
      ? limit <= 1
        ? 'needs at least one entry'
        : `needs at least ${limit} entries`
      : `can have at most ${inclusive ? limit : limit - 1} entries`;
  if (origin === 'number') {
    if (small && limit === 0)
      return inclusive ? 'cannot be negative' : 'must be greater than 0';
    // Measurements are sent in millimetres, so a limit would not read in
    // the units the operator typed.
    const field = pathSegments(issue.path).findLast((s) => !ROW.test(s));
    if (field && /Mm2?$/.test(field))
      return small ? 'is too small' : 'is too large';
    const shown = limit.toLocaleString('en-US');
    return small
      ? `must be ${inclusive ? 'at least' : 'greater than'} ${shown}`
      : `must be ${inclusive ? 'at most' : 'less than'} ${shown}`;
  }
  return small ? 'is too small' : 'is too large';
}
