'use client';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  addDays,
  addMonths,
  isWeekend,
  mondayOf,
  monthOf,
  monthWeeks,
  nextWeekday,
  today,
} from '@/lib/calendar-dates';
import { calendarDateLabel, monthLabel, weekdayLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A calendar day (`YYYY-MM-DD`) picked from a month grid instead of typed.
 * The grid opens in the document flow, like Lookup's list, so a dialog never
 * clips it. `weekdaysOnly` leaves Saturday and Sunday out of the grid.
 */
export function DateField({
  label,
  value,
  onChange,
  weekdaysOnly = false,
  defaultOpen = false,
  hint,
  error,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  weekdaysOnly?: boolean;
  /** Start with the calendar showing, for a dialog that only picks a date. */
  defaultOpen?: boolean;
  hint?: string;
  error?: string;
  optional?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const start = () => {
    const day = value || today();
    return weekdaysOnly ? nextWeekday(day) : day;
  };
  // The day the arrow keys are on, and the month on show; the month buttons
  // change the second without moving the first.
  const [cursor, setCursor] = useState(start);
  const [month, setMonth] = useState(() => monthOf(start()));
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Set when the keyboard moved the cursor, so focus follows it after render.
  const follow = useRef(false);
  useEffect(() => {
    if (!open || !follow.current) return;
    follow.current = false;
    field.current
      ?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)
      ?.focus();
  }, [open, cursor, month]);
  function show() {
    const day = start();
    setCursor(day);
    setMonth(monthOf(day));
    follow.current = true;
    setOpen(true);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function moveTo(day: string) {
    const next = weekdaysOnly && isWeekend(day) ? nextWeekday(day) : day;
    setCursor(next);
    setMonth(monthOf(next));
    follow.current = true;
  }
  function step(days: number) {
    let next = addDays(cursor, days);
    // Sideways steps pass over the weekend the grid does not show.
    while (weekdaysOnly && isWeekend(next)) next = addDays(next, days);
    moveTo(next);
  }
  function onKeyDown(event: KeyboardEvent) {
    const monday = mondayOf(cursor);
    const moves: Record<string, () => void> = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      ArrowUp: () => moveTo(addDays(cursor, -7)),
      ArrowDown: () => moveTo(addDays(cursor, 7)),
      Home: () => moveTo(monday),
      End: () => moveTo(addDays(monday, weekdaysOnly ? 4 : 6)),
      PageUp: () => moveTo(addDays(cursor, -28)),
      PageDown: () => moveTo(addDays(cursor, 28)),
      Escape: close,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  }
  const weeks = monthWeeks(month, weekdaysOnly);
  const monthId = `${id}-month`;
  return (
    <div
      className="field"
      ref={field}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        {optional && <span className="field-optional">Optional</span>}
      </span>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cn('input date-trigger', !value && 'is-empty')}
        aria-haspopup="dialog"
        aria-expanded={open}
        // A button cannot be aria-invalid; the error is its description.
        data-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            show();
          }
        }}
      >
        {value ? calendarDateLabel(value) : 'Choose a date'}
        <CalendarDays size={16} aria-hidden />
      </button>
      {open && (
        // Escape here closes the calendar; the Dialog leaves it alone.
        <div
          className="calendar"
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
          data-keeps-escape
          onKeyDown={onKeyDown}
          // Safari does not focus a clicked button, which would read as the
          // field losing focus and close the calendar under the pointer.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="calendar-heading">
            <button
              type="button"
              className="button button-ghost button-icon"
              aria-label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <strong id={monthId} aria-live="polite">
              {monthLabel(month)}
            </strong>
            <button
              type="button"
              className="button button-ghost button-icon"
              aria-label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div
            className="calendar-grid"
            role="grid"
            aria-labelledby={monthId}
            style={{ '--calendar-days': weeks[0]!.length } as CSSProperties}
          >
            <div role="row">
              {weeks[0]!.map((day) => (
                <span key={day} role="columnheader">
                  {weekdayLabel(day)}
                </span>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0]} role="row">
                {week.map((day) => (
                  <span key={day} role="gridcell" aria-selected={day === value}>
                    <button
                      type="button"
                      data-day={day}
                      // Only the cursor's day is a tab stop; arrows do the rest.
                      tabIndex={day === cursor ? 0 : -1}
                      aria-label={calendarDateLabel(day)}
                      aria-current={day === today() ? 'date' : undefined}
                      className={cn(
                        'calendar-day',
                        monthOf(day) !== month && 'is-outside',
                        day === value && 'is-selected',
                      )}
                      onClick={() => {
                        onChange(day);
                        close();
                      }}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {error ? (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      ) : (
        hint && <small>{hint}</small>
      )}
    </div>
  );
}
