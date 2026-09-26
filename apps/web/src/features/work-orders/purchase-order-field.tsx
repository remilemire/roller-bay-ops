'use client';
import { X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

const COMPLETE = /^\d{5}$/;

/**
 * A back order's purchase orders as chips in one box. A number becomes a
 * chip once its fifth digit is typed; Enter or leaving the box keeps a
 * shorter one as a chip marked invalid, so it is refused rather than lost.
 * Backspace in the empty box removes the last chip, and a pasted list adds
 * every number in it.
 */
export function PurchaseOrderField({
  value,
  onChange,
  error,
  hint = '5-digit numbers',
}: {
  value: string[];
  onChange: (numbers: string[]) => void;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const add = (numbers: string[]) => {
    const next = [...value];
    for (const number of numbers)
      if (number && !next.includes(number)) next.push(number);
    if (next.length !== value.length) onChange(next);
  };
  const keep = () => {
    if (!text) return;
    add([text]);
    setText('');
  };
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>PO numbers</label>
      </span>
      {/* Clicking anywhere in the box types into it. */}
      <div
        className="input tag-input"
        data-invalid={error ? true : undefined}
        onClick={() => input.current?.focus()}
      >
        {value.map((number) => (
          <span
            key={number}
            className="tag-chip"
            data-invalid={COMPLETE.test(number) ? undefined : true}
          >
            {number}
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`Remove PO ${number}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((other) => other !== number));
                input.current?.focus();
              }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          value={text}
          inputMode="numeric"
          autoComplete="off"
          aria-required={value.length === 0}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-note`}
          onChange={(event) => {
            const parts = event.target.value.split(/\D+/);
            // Every finished number is added; what is still being typed stays.
            let rest = parts.pop()!;
            const complete = parts.filter(Boolean);
            for (; rest.length >= 5; rest = rest.slice(5))
              complete.push(rest.slice(0, 5));
            add(complete);
            setText(rest);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text) {
              // Keeps the number instead of submitting the form.
              event.preventDefault();
              keep();
            } else if (event.key === 'Backspace' && !text && value.length)
              onChange(value.slice(0, -1));
          }}
          onBlur={keep}
        />
      </div>
      <small className={error ? 'field-error' : undefined} id={`${id}-note`}>
        {error ?? hint}
      </small>
    </div>
  );
}
