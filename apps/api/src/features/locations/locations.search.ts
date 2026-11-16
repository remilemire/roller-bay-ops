import { ilike, or, sql, type Column } from 'drizzle-orm';
import { containsPattern } from './locations.persistence.js';

export function matchesLocationAddress(search: string, ...parts: Column[]) {
  const literal = containsPattern(search);
  const compact = search.replace(/[\s/-]+/g, '');
  return or(
    ...parts.map((part) => ilike(part, literal)),
    // Keep every part on the same address: sibling levels must never combine
    // into a match. Preserve literal punctuation and SQL wildcard escaping.
    compact
      ? ilike(
          sql`regexp_replace(concat_ws('', ${sql.join(parts, sql`, `)}), '[[:space:]/-]+', '', 'g')`,
          containsPattern(compact),
        )
      : undefined,
  );
}
