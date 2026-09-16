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

export function describeError(error: unknown): {
  message: string;
  details: string[];
} {
  if (error instanceof z.ZodError)
    return {
      message: INVALID_FIELDS_MESSAGE,
      details: describeIssues(
        error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path.map(String),
        })),
      ),
    };
  if (error instanceof ApiError)
    return { message: error.message, details: describeIssues(error.issues) };
  return { message: GENERIC_ERROR_MESSAGE, details: [] };
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

/** `plan.drops.0.items.1.widthMm` becomes `Plan › drop 1 › item 2 › width`. */
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
  if (/^Too small/.test(message)) return 'is too small';
  if (/^Too big/.test(message)) return 'is too large';
  if (/^Invalid number: must be a multiple of/.test(message))
    return 'has too many decimal places';
  if (/^Invalid (input|UUID|string|ISO)/.test(message)) return 'is invalid';
  return null;
}
