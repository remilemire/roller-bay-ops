import type { Logger } from '@nestjs/common';

const MAX_CAUSE_DEPTH = 10;

/**
 * Records a server fault (status 500 and above) with its cause chain. Client
 * errors are expected outcomes and are not logged. Only the request method and
 * path are recorded: the query string can carry the OAuth authorization code,
 * and headers, cookies, and bodies never reach the log.
 */
export function logServerFault(
  logger: Logger,
  request: { method: string; originalUrl?: string; url?: string },
  status: number,
  error: unknown,
): void {
  if (status < 500) return;
  logger.error(
    `${request.method} ${requestPath(request)} -> ${status}`,
    describeCauseChain(error),
  );
}

/** Stack traces down the `cause` chain. */
export function describeCauseChain(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<object>();
  let current: unknown = error;
  while (
    current !== undefined &&
    current !== null &&
    lines.length < MAX_CAUSE_DEPTH
  ) {
    if (typeof current === 'object') {
      if (seen.has(current)) break;
      seen.add(current);
    }
    lines.push(describeLink(current));
    current =
      typeof current === 'object' && 'cause' in current
        ? current.cause
        : undefined;
  }
  return lines.join('\nCaused by: ');
}

// Non-Error objects are summarised, never serialised: http-errors carry the raw
// request body and adapter errors can reference request objects.
function describeLink(value: unknown): string {
  if (value instanceof Error)
    return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'object' && value !== null) {
    const name = value.constructor?.name ?? 'object';
    return 'code' in value ? `${name} code=${String(value.code)}` : name;
  }
  return String(value);
}

/** Path without its query string. */
export function requestPath(request: {
  originalUrl?: string;
  url?: string;
}): string {
  return (request.originalUrl ?? request.url ?? '').split('?', 1)[0] ?? '';
}
