import {
  LocationLabelConflictError,
  LocationInUseError,
  LocationReferenceNotFoundError,
} from './locations.errors.js';

// Keep driver codes and Drizzle's error wrappers inside the persistence layer.
export async function locationsQuery<T>(
  operation: () => Promise<T>,
  deleting = false,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const seen = new Set<object>();
    let cause: unknown = error;
    while (typeof cause === 'object' && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ('code' in cause) {
        if (
          cause.code === '23505' &&
          'constraint' in cause &&
          typeof cause.constraint === 'string' &&
          [
            'location_zones_name_unique',
            'location_sections_zone_label_unique',
            'locations_section_label_unique',
          ].includes(cause.constraint)
        )
          throw new LocationLabelConflictError(
            'Name or label already exists within this parent.',
            {
              cause: error,
            },
          );
        if (cause.code === '23503') {
          if (deleting)
            throw new LocationInUseError(
              'This location record is still referenced.',
              { cause: error },
            );
          throw new LocationReferenceNotFoundError(
            'The referenced location record does not exist.',
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
