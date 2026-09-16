'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from './button';
import { Input, Select } from './input';
export function Lookup({
  label,
  value,
  onChange,
  queryKey,
  load,
  selectedLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  queryKey: readonly unknown[];
  load: (
    search: string,
    page: number,
    signal: AbortSignal,
  ) => Promise<{ items: { id: string; label: string }[]; total: number }>;
  selectedLabel?: string;
}) {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: [...queryKey, 'lookup', search, page],
    queryFn: ({ signal }) => load(search, page, signal),
  });
  const items = result.data?.items ?? [];
  return (
    <div className="field lookup">
      <label>
        <span>{label}</span>
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        >
          <option value="">Select…</option>
          {value && !items.some((i) => i.id === value) && (
            <option value={value}>
              {selectedLabel ?? `Selected · ${value.slice(0, 8).toUpperCase()}`}
            </option>
          )}
          {items.map((i) => (
            <option value={i.id} key={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="lookup-controls">
        <Input
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Search options…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setSearch(term);
              setPage(1);
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => {
            setSearch(term);
            setPage(1);
          }}
        >
          Find
        </Button>
      </div>
      {result.isPending ? (
        <small role="status">Loading options…</small>
      ) : result.error ? (
        <small role="alert">
          Could not load options.{' '}
          <button type="button" onClick={() => void result.refetch()}>
            Retry
          </button>
        </small>
      ) : (
        <div className="inline-actions">
          <small>
            {result.data?.total ?? 0} matches · page {page}
          </small>
          {page > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
          )}
          {(result.data?.total ?? 0) > page * 25 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
