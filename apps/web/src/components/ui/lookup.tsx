'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
const SEARCH_DELAY_MS = 250;
/**
 * A single text input that searches as you type and lists the matches to pick
 * from. The list renders in the document flow rather than floating, so it is
 * never clipped by a panel or dialog and needs no positioning.
 */
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
  const id = useId();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  // Labels of options picked here, so a selection keeps its text after the
  // list has moved on to other search results.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusedByPointer = useRef(false);
  // The query key keeps the page slot so review screens can still read
  // cached option labels.
  const result = useQuery({
    queryKey: [...queryKey, 'lookup', search, 1],
    queryFn: ({ signal }) => load(search, 1, signal),
    placeholderData: keepPreviousData,
  });
  const items = result.data?.items ?? [];
  const total = result.data?.total ?? 0;
  const selected = value
    ? (picked[value] ??
      items.find((item) => item.id === value)?.label ??
      selectedLabel ??
      `Selected · ${value.slice(0, 8).toUpperCase()}`)
    : '';
  // Opening shows the current selection; typing over it searches instead.
  const query = term === selected ? '' : term.trim();
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  // New results start the keyboard cursor at the top again.
  const [seen, setSeen] = useState(result.data);
  if (seen !== result.data) {
    setSeen(result.data);
    setActive(0);
  }
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  function pick(item: { id: string; label: string }) {
    setPicked((known) => ({ ...known, [item.id]: item.label }));
    onChange(item.id);
    setOpen(false);
  }
  const listId = `${id}-list`;
  const labelId = `${id}-label`;
  return (
    <div className="field">
      <label id={labelId} htmlFor={id}>
        {label}
      </label>
      <div className="combobox">
        <input
          ref={input}
          id={id}
          className="input"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && items[active] ? `${id}-option-${active}` : undefined
          }
          placeholder="Type to search…"
          value={open ? term : selected}
          onMouseDown={() => {
            focusedByPointer.current = document.activeElement !== input.current;
          }}
          onFocus={(event) => {
            setTerm(selected);
            setOpen(true);
            event.target.select();
          }}
          onMouseUp={(event) => {
            // Keep the select-all from focusing; a click's mouseup would undo it.
            if (focusedByPointer.current) event.preventDefault();
            focusedByPointer.current = false;
          }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
            // An emptied box means no selection.
            if (event.target.value === '' && value) onChange('');
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (open) setActive(Math.min(active + 1, items.length - 1));
              else setOpen(true);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(active - 1, 0));
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              const item = items[active];
              if (item) pick(item);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="combobox-clear"
            aria-label={`Clear ${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setTerm('');
              setOpen(true);
              input.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listId}
          ref={list}
          className="combobox-list"
          role="listbox"
          aria-labelledby={labelId}
          onMouseDown={(event) => event.preventDefault()}
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={item.id === value}
              className={cn(index === active && 'is-active')}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(item)}
            >
              {item.label}
            </li>
          ))}
          {!items.length && result.data && !result.error && (
            <li className="combobox-empty" role="presentation">
              No matches.
            </li>
          )}
        </ul>
      )}
      {result.error ? (
        <small role="alert">
          Could not load options.{' '}
          <button type="button" onClick={() => void result.refetch()}>
            Retry
          </button>
        </small>
      ) : result.isPending ? (
        <small role="status">Loading options…</small>
      ) : open && result.isFetching ? (
        <small role="status">Searching…</small>
      ) : open && total > items.length ? (
        <small role="status">
          Showing {items.length} of {total} matches. Keep typing to narrow the
          list.
        </small>
      ) : null}
    </div>
  );
}
