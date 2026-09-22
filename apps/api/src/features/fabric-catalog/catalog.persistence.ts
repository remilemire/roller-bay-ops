import {
  CatalogCodeConflictError,
  CatalogInUseError,
  CatalogReferenceNotFoundError,
} from './catalog.errors.js';

// Keep driver codes and Drizzle's error wrappers inside the persistence layer.
export async function catalogQuery<T>(
  operation: () => Promise<T>,
  deleting = false,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // The service also translates commit failures. Preserve a query's existing
    // classification, especially a foreign-key error from a delete.
    if (
      error instanceof CatalogCodeConflictError ||
      error instanceof CatalogInUseError ||
      error instanceof CatalogReferenceNotFoundError
    )
      throw error;
    const seen = new Set<object>();
    let cause: unknown = error;
    while (typeof cause === 'object' && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ('code' in cause) {
        if (
          cause.code === '23505' &&
          'constraint' in cause &&
          cause.constraint === 'fabric_colors_code_unique'
        )
          throw new CatalogCodeConflictError('Color code already exists.', {
            cause: error,
          });
        if (cause.code === '23503') {
          if (deleting)
            throw new CatalogInUseError(
              'This catalog record is still referenced.',
              { cause: error },
            );
          throw new CatalogReferenceNotFoundError(
            'The referenced catalog record does not exist.',
            { cause: error },
          );
        }
      }
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw error;
  }
}

export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}
