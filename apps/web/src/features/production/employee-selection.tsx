'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/feedback';
import { productionEmployees } from './production.api';
export function useEmployeeSelection() {
  // In memory: logout, reload, or a station change clears attribution.
  const [employeeIds, selectEmployees] = useState<string[]>([]);
  return { employeeIds, selectEmployees };
}
/** Every employee who completed the work, as a checkbox group. */
export function EmployeeSelection({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const query = useQuery(productionEmployees());
  useEffect(() => {
    if (!query.data) return;
    const active = value.filter((id) => query.data.some((e) => e.id === id));
    if (active.length !== value.length) onChange(active);
  }, [value, query.data, onChange]);
  if (query.error) return <ErrorNotice error={query.error} />;
  const options = query.data ?? [];
  return (
    <fieldset className="employee-picker">
      <legend>Completed by</legend>
      {query.isPending ? (
        <p className="muted">Loading employees…</p>
      ) : !options.length ? (
        <p className="muted">No active employees.</p>
      ) : (
        <div className="employee-picker-grid">
          {options.map((e) => (
            <label className="employee-picker-option" key={e.id}>
              <input
                type="checkbox"
                checked={value.includes(e.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, e.id]
                      : value.filter((id) => id !== e.id),
                  )
                }
              />
              <span>
                {e.name} — {e.initials}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
