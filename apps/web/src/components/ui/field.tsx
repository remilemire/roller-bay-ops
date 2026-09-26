import { useId, type ComponentProps, type ReactNode } from 'react';
import { InfoTip } from './info-tip';
import { Input, Select } from './input';
export function Field({
  label,
  children,
  hint,
  help,
  htmlFor,
  helpId,
  error,
  errorId,
  optional = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  help?: string;
  htmlFor?: string;
  helpId?: string;
  error?: string;
  errorId?: string;
  /** Marks a field that may be left blank; required ones stay unmarked. */
  optional?: boolean;
}) {
  // A wrapping label would also name the control after its tooltip button and
  // error text, so fields that know their control's id label it explicitly.
  // The structure must not depend on whether an error is showing: switching
  // it would remount the input and drop focus mid-correction.
  if (htmlFor)
    return (
      <div className="field">
        <span className="field-label">
          <label htmlFor={htmlFor}>{label}</label>
          {help && <InfoTip text={help} id={helpId} />}
          {optional && <span className="field-optional">Optional</span>}
        </span>
        {children}
        {/* The error takes the hint's line, so a check that runs on blur does
            not shift the page under the pointer's next click. */}
        {error ? (
          <small className="field-error" id={errorId}>
            {error}
          </small>
        ) : (
          hint && <small>{hint}</small>
        )}
      </div>
    );
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  hint,
  help,
  disabled = false,
  maxLength,
  inputMode,
  error,
  onBlur,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  help?: string;
  disabled?: boolean;
  maxLength?: number;
  inputMode?: ComponentProps<'input'>['inputMode'];
  error?: string;
  onBlur?: () => void;
}) {
  const id = useId();
  const helpId = useId();
  const errorId = useId();
  return (
    <Field
      label={label}
      hint={hint}
      help={help}
      htmlFor={id}
      helpId={helpId}
      error={error}
      errorId={errorId}
      optional={optional}
    >
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(help && helpId, error && errorId)}
        onBlur={onBlur}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        inputMode={inputMode}
      />
    </Field>
  );
}
export function ChoiceField({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}) {
  const id = useId();
  const errorId = useId();
  return (
    <Field label={label} htmlFor={id} error={error} errorId={errorId}>
      <Select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
const describedBy = (...ids: (string | false | undefined)[]) =>
  ids.filter(Boolean).join(' ') || undefined;
