import { HttpException } from '@nestjs/common';
import { errorIssueSchema, type ApiErrorBody } from '@roller-bay/shared/errors';
import { z } from 'zod';

export const UNEXPECTED_ERROR_MESSAGE =
  'Something went wrong on our side. Please try again.';
export const UNREADABLE_REQUEST_MESSAGE =
  'The request could not be read. Check the submitted data and try again.';
const REQUEST_ERROR_MESSAGE = 'The request could not be completed.';

// Express-level failures (body parsing, raw-body limits, path decoding) carry
// text that describes the raw request: offsets, encodings, sizes, bytes.
const REQUEST_ERROR_MESSAGES = new Map<number, string>([
  [400, UNREADABLE_REQUEST_MESSAGE],
  [413, 'The request is too large.'],
  [415, 'The request format is not supported.'],
]);

const issuesSchema = z.array(errorIssueSchema).min(1);

export interface TranslatedError {
  status: number;
  /** Exactly the shared envelope; nothing else leaves the API. */
  body: ApiErrorBody;
}

/**
 * Decides the response for anything thrown while handling a request.
 * HttpExceptions are trusted because feature code constructs them with curated
 * literals; everything else is replaced by generic copy.
 */
export function translateError(error: unknown): TranslatedError {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const payload = error.getResponse();
    const message =
      typeof payload === 'string' ? payload : stringField(payload, 'message');
    const issues =
      typeof payload === 'object' && 'issues' in payload
        ? issuesSchema.safeParse(payload.issues)
        : undefined;
    return {
      status,
      body: {
        statusCode: status,
        message:
          message ||
          (status >= 500 ? UNEXPECTED_ERROR_MESSAGE : REQUEST_ERROR_MESSAGE),
        ...(issues?.success ? { issues: issues.data } : {}),
      },
    };
  }
  const status = clientStatusOf(error);
  if (status !== undefined)
    return {
      status,
      body: {
        statusCode: status,
        message: REQUEST_ERROR_MESSAGES.get(status) ?? REQUEST_ERROR_MESSAGE,
      },
    };
  return {
    status: 500,
    body: { statusCode: 500, message: UNEXPECTED_ERROR_MESSAGE },
  };
}

function stringField(payload: object, key: string): string | undefined {
  if (!(key in payload)) return undefined;
  const value: unknown = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Only client statuses are trusted from third-party errors; a middleware's own
// 5xx has no user-facing meaning beyond "unexpected". http-errors sets both
// `statusCode` and `status`; Express's path decoder sets only `status`.
function clientStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  for (const key of ['statusCode', 'status']) {
    if (!(key in error)) continue;
    const value: unknown = (error as Record<string, unknown>)[key];
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 400 &&
      value < 500
    )
      return value;
  }
  return undefined;
}
