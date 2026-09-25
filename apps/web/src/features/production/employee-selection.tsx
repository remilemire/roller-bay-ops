'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Lookup } from '@/components/ui/lookup';
import { ErrorNotice } from '@/components/ui/feedback';
import { productionEmployees, productionKey } from './production.api';
const optionLabel = (e: { name: string; initials: string }) =>
  `${e.name} — ${e.initials}`;
/**
 * Every employee who completed the work: a search box adds one at a time and
 * each selection shows as a chip that can be removed.
 */
export function EmployeeSelection({
  value,
  onChange,
  label = 'Completed by',
}: {
  label?: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const client = useQueryClient();
  const query = useQuery(productionEmployees());
  useEffect(() => {
    if (!query.data) return;
    const active = value.filter((id) => query.data.some((e) => e.id === id));
    if (active.length !== value.length) onChange(active);
  }, [value, query.data, onChange]);
  if (query.error)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const chosen = value.flatMap(
    (id) => query.data?.find((e) => e.id === id) ?? [],
  );
  return (
    <div className="employee-selection">
      <Lookup
        label={label}
        value=""
        onChange={(id) => {
          if (id && !value.includes(id)) onChange([...value, id]);
        }}
        // Already chosen employees leave the list, so results depend on the
        // selection as well as the search.
        queryKey={[...productionKey, 'employees', 'pick', value]}
        load={async (search) => {
          const all = await client.ensureQueryData(productionEmployees());
          const term = search.trim().toLowerCase();
          const items = all
            .filter(
              (e) =>
                !value.includes(e.id) &&
                (!term ||
                  e.name.toLowerCase().includes(term) ||
                  e.initials.toLowerCase().includes(term)),
            )
            .map((e) => ({ id: e.id, label: optionLabel(e) }));
          return { items, total: items.length };
        }}
      />
      {chosen.length > 0 && (
        <ul className="employee-chips" aria-label="Selected employees">
          {chosen.map((e) => (
            <li key={e.id} className="employee-chip">
              <span>{optionLabel(e)}</span>
              <button
                type="button"
                className="employee-chip-remove"
                aria-label={`Remove ${e.name}`}
                onClick={() => onChange(value.filter((id) => id !== e.id))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
