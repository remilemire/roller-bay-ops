'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { LengthUnit } from '@roller-bay/shared/users';
import { inchParts, joinInches, parseAmount } from '@/lib/measurements';
import { cn } from '@/lib/utils';
import { describedBy, Field } from './field';

// The picker's marks, 0 then each sixteenth, four to a row like a ruler.
const marks = Array.from({ length: 16 }, (_, n) => {
  if (n === 0) return '';
  let [top, bottom] = [n, 16];
  while (top % 2 === 0) [top, bottom] = [top / 2, bottom / 2];
  return `${top}/${bottom}`;
});
const columns = 4;
// A typed fraction ending in one of these denominators, or a fraction glyph,
// is complete and moves beside the number at once. Others could still be
// growing ("1/3" before "1/32"), so they wait for the field to be left.
const completeFraction = /(\/\s*(2|4|8|16|32|64)|[½¼¾⅛⅜⅝⅞])\s*$/;

function Fraction({ value }: { value: string }) {
  const [top, bottom] = value.split('/');
  return (
    <span className="fraction" aria-hidden>
      <sup>{top}</sup>⁄<sub>{bottom}</sub>
    </span>
  );
}

/**
 * A length typed as a number. Inch fields keep the fraction beside the typed
 * whole number, picked from a ruler-like grid since tablet number pads have
 * no slash; it goes away while the number has a decimal point. A mixed number
 * typed on a keyboard ("72 5/8", "72½") moves its fraction there as soon as
 * it is complete, or on blur when that is ambiguous.
 * The form value stays one string such as "72 5/8". Unreadable text fails
 * native form validation, so it cannot be submitted as a blank.
 */
export function MeasurementField({
  label,
  unit,
  value,
  onChange,
  required = false,
  optional = false,
  hint,
  help,
  disabled = false,
  error,
  onBlur,
}: {
  label: string;
  unit: LengthUnit;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  help?: string;
  disabled?: boolean;
  error?: string;
  onBlur?: () => void;
}) {
  const id = useId();
  const helpId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const inches = unit === 'in';
  // The typed half is kept apart from the value so a half-typed fraction
  // ("72 5/") is not split until the field is left; a value set from outside,
  // such as a form reset, replaces it.
  const [parts, setParts] = useState(() =>
    inches ? inchParts(value) : { whole: value, fraction: '' },
  );
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    if ((inches ? joinInches(parts) : parts.whole) !== value)
      setParts(inches ? inchParts(value) : { whole: value, fraction: '' });
  }
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [left, setLeft] = useState(false);
  const amount = parseAmount(value);
  const unreadable =
    amount !== null && Number.isNaN(amount) ? 'Enter a number.' : '';
  useEffect(() => input.current?.setCustomValidity(unreadable), [unreadable]);
  useEffect(() => {
    if (open)
      grid.current
        ?.querySelector<HTMLElement>(`[data-mark="${cursor}"]`)
        ?.focus();
  }, [open, cursor]);
  const shownError = (error ?? (left && unreadable)) || undefined;
  const hasFraction = inches && !parts.whole.includes('.');
  const update = (next: typeof parts) => {
    setParts(next);
    onChange(inches ? joinInches(next) : next.whole);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (fraction: string) => {
    update({ ...parts, fraction });
    close();
  };
  const onGridKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key in moves) {
      event.preventDefault();
      setCursor((at) =>
        Math.min(marks.length - 1, Math.max(0, at + moves[event.key]!)),
      );
    }
  };
  return (
    <Field
      label={label}
      hint={hint}
      help={help}
      htmlFor={id}
      helpId={helpId}
      error={shownError}
      errorId={errorId}
      optional={optional}
    >
      <div
        className="measurement-control"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        <div
          className={cn('input measurement-input', disabled && 'is-disabled')}
          data-invalid={shownError ? true : undefined}
        >
          <input
            ref={input}
            className="measurement-amount"
            id={id}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={describedBy(
              help && helpId,
              shownError && errorId,
            )}
            value={parts.whole}
            onChange={(e) => {
              setLeft(false);
              const whole = e.target.value;
              const split = completeFraction.test(whole) && inchParts(whole);
              if (inches && split && split.fraction) update(split);
              else
                update({
                  whole,
                  fraction: whole.includes('.') ? '' : parts.fraction,
                });
            }}
            onBlur={() => {
              setLeft(true);
              if (inches && /[/½¼¾⅛⅜⅝⅞⁄]/.test(parts.whole)) {
                const split = inchParts(parts.whole);
                if (split.fraction) update(split);
              }
              onBlur?.();
            }}
            // A bare fraction such as 1/2 leaves the typed half empty.
            required={required && !(hasFraction && parts.fraction)}
            disabled={disabled}
            inputMode="decimal"
            autoComplete="off"
          />
          {hasFraction && (
            <button
              ref={trigger}
              type="button"
              className={cn(
                'measurement-fraction',
                !parts.fraction && 'is-empty',
              )}
              aria-label={`${label.replace(/\s*\([^)]*\)$/, '')} fraction${parts.fraction ? `: ${parts.fraction}` : ''}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={disabled}
              onClick={() => {
                if (open) return setOpen(false);
                setCursor(Math.max(0, marks.indexOf(parts.fraction)));
                setOpen(true);
              }}
            >
              {parts.fraction ? (
                <Fraction value={parts.fraction} />
              ) : (
                '+ fraction'
              )}
            </button>
          )}
        </div>
        {open && hasFraction && (
          // Escape here closes the grid; the Dialog leaves it alone.
          <div
            ref={grid}
            className="fraction-picker"
            role="dialog"
            aria-label={`Choose ${label.replace(/\s*\([^)]*\)$/, '').toLowerCase()} fraction`}
            data-keeps-escape
            onKeyDown={onGridKeyDown}
            // Safari does not focus a clicked button, which would read as the
            // field losing focus and close the grid under the pointer.
            onMouseDown={(event) => event.preventDefault()}
          >
            {marks.map((mark, index) => (
              <button
                key={mark || 'none'}
                type="button"
                data-mark={index}
                // Only the cursor's mark is a tab stop; arrows do the rest.
                tabIndex={index === cursor ? 0 : -1}
                aria-label={mark || 'No fraction'}
                aria-pressed={mark === parts.fraction}
                className={cn(
                  'fraction-mark',
                  index % 2 === 1 && 'is-sixteenth',
                )}
                onClick={() => pick(mark)}
              >
                {mark ? <Fraction value={mark} /> : '0'}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
