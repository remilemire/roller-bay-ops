'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChoiceField } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/feedback';
import { productionEmployees } from './production.api';
const timeout = 15 * 60 * 1000;
export function useEmployeeSelection() {
  const [selection, setSelection] = useState({ id: '', at: 0 });
  // Deliberately in memory: logout, reload, or a station change clears attribution.
  useEffect(() => {
    const timer = setInterval(
      () =>
        setSelection((v) =>
          v.id && Date.now() - v.at >= timeout ? { id: '', at: 0 } : v,
        ),
      10000,
    );
    return () => clearInterval(timer);
  }, []);
  return {
    employeeId: selection.id,
    selectEmployee: (id: string) => setSelection({ id, at: Date.now() }),
    touch: () => setSelection((v) => ({ ...v, at: Date.now() })),
  };
}
export function EmployeeSelection({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const query = useQuery(productionEmployees());
  useEffect(() => {
    if (value && query.data && !query.data.some((e) => e.id === value))
      onChange('');
  }, [value, query.data, onChange]);
  if (query.error) return <ErrorNotice error={query.error} />;
  return (
    <>
      <ChoiceField
        label="Completed by"
        value={value}
        onChange={onChange}
        placeholder={query.isPending ? 'Loading employees…' : 'Choose employee'}
        options={(query.data ?? []).map((e) => ({
          value: e.id,
          label: `${e.name} — ${e.initials}`,
        }))}
      />
      <p className="muted">
        Confirm the employee before each completion. Selection clears after 15
        minutes without recording work.
      </p>
    </>
  );
}
