'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChoiceField } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/feedback';
import { productionEmployees } from './production.api';
export function useEmployeeSelection() {
  // In memory: logout, reload, or a station change clears attribution.
  const [employeeId, selectEmployee] = useState('');
  return { employeeId, selectEmployee };
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
  );
}
