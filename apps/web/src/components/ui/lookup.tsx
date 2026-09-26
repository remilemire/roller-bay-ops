'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
const SEARCH_DELAY_MS = 250;
/**
 * A single text input that searches as you type and lists the matches to pick
 * from. While the list is open the box holds only the search text and shows
 * the current selection as its placeholder; closed, it shows the selection.
 * The list renders in the document flow rather than floating, so it is never
 * clipped by a panel or dialog and needs no positioning.
 */
export function Lookup({
  label,
  value,
  onChange,
  queryKey,
  load,
  selectedLabel,
  error,
  create,
  optional = false,
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
  error?: string;
  optional?: boolean;
  /**
   * An extra last option that creates what the search names, offered once
   * the results for that search are in and `label` returns one for them.
   */
  create?: {
    label: (
      search: string,
      items: readonly { id: string; label: string }[],
    ) => string | null;
    onSelect: (search: string) => void;
  };
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
  const query = term.trim();
  const creating =
    create && query && search === query && result.data && !result.isFetching
      ? create.label(query, items)
      : null;
  // The options the keyboard walks: the matches, then the create option.
  const count = items.length + (creating ? 1 : 0);
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
  function close() {
    setOpen(false);
    setTerm('');
  }
  function pick(item: { id: string; label: string }) {
    setPicked((known) => ({ ...known, [item.id]: item.label }));
    onChange(item.id);
    close();
  }
  function clear() {
    onChange('');
    setTerm('');
    setOpen(true);
  }
  function choose(index: number) {
    const item = items[index];
    if (item) pick(item);
    else if (creating && index === items.length) {
      close();
      // Creating usually opens a dialog; focus coming back here must not
      // reopen the list over the selection it makes.
      input.current?.blur();
      create!.onSelect(query);
    }
  }
  function move(step: number) {
    if (!count) return;
    setActive(Math.min(Math.max(active + step, 0), count - 1));
  }
  const listId = `${id}-list`;
  const labelId = `${id}-label`;
  return (
    <div className="field">
      <span className="field-label">
        <label id={labelId} htmlFor={id}>
          {label}
        </label>
        {optional && <span className="field-optional">Optional</span>}
      </span>
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
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [error && `${id}-error`, result.error && `${id}-load-error`]
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-activedescendant={
            open && active < count ? `${id}-option-${active}` : undefined
          }
          placeholder={selected || 'Type to search…'}
          value={open ? term : selected}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            const next = event.target.value;
            // Typing into the closed box edits the selection's label; keep
            // only what was added and start a search with it.
            setTerm(
              open
                ? next
                : next.startsWith(selected)
                  ? next.slice(selected.length)
                  : next,
            );
            setOpen(true);
          }}
          onBlur={close}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (open) move(1);
              else setOpen(true);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            } else if (event.key === 'Tab' && open && count) {
              // Tab walks the options; past either end it leaves the field.
              const next = active + (event.shiftKey ? -1 : 1);
              if (next < 0 || next >= count) close();
              else {
                event.preventDefault();
                setActive(next);
              }
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              choose(active);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              close();
            } else if (
              (event.key === 'Backspace' || event.key === 'Delete') &&
              value &&
              (!open || term === '')
            ) {
              // Deleting from an empty search, or from the shown selection,
              // removes the selection rather than editing its label.
              event.preventDefault();
              clear();
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
              clear();
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
          {creating && (
            <li
              id={`${id}-option-${items.length}`}
              role="option"
              aria-selected={false}
              className={cn(
                'combobox-create',
                active === items.length && 'is-active',
              )}
              onMouseEnter={() => setActive(items.length)}
              onClick={() => choose(items.length)}
            >
              {creating}
            </li>
          )}
          {!count && result.data && !result.error && (
            <li className="combobox-empty" role="presentation">
              No matches.
            </li>
          )}
        </ul>
      )}
      {result.error ? (
        <div className="lookup-error" role="alert" id={`${id}-load-error`}>
          <small className="field-error">Could not load options.</small>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void result.refetch()}
          >
            Retry
          </Button>
        </div>
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
      {error && (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
