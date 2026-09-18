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

/** `plan.cuts.0.items.1.widthMm` becomes `Plan › cut 1 › item 2 › width`. */
export function describeIssuePath(path: ErrorIssue['path']): string {
  const segments = (typeof path === 'string' ? path.split('.') : (path ?? []))
    .map(String)
    // "context" names the validator's stock snapshot, not a form section.
    .filter(
      (segment, index) =>
        segment !== '' && !(index === 0 && segment === 'context'),
    );
  const parts: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const next = segments[index + 1];
    if (INDEX.test(segment)) {
      parts.push(ordinal(segment));
      continue;
    }
    const label = words(segment);
    if (next !== undefined && INDEX.test(next)) {
      parts.push(`${singular(label)} ${ordinal(next)}`);
      index++;
    } else parts.push(label);
  }
  const text = parts.join(' › ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ordinal = (segment: string) => String(Number(segment) + 1);
const words = (segment: string) =>
  segment
    .replace(/Mm2?$/, '')
    .replace(/([a-z0-9])Id$/, '$1')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
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
  // A choice left unselected fails the payload's discriminator.
  if (/^Invalid discriminator value/.test(message)) return 'is required';
  if (/^Too small/.test(message)) return 'is too small';
  if (/^Too big/.test(message)) return 'is too large';
  if (/^Invalid number: must be a multiple of/.test(message))
    return 'has too many decimal places';
  if (/^Invalid (input|UUID|string|ISO)/.test(message)) return 'is invalid';
  return null;
}
