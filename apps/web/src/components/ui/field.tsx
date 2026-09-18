import { useId, type ReactNode } from 'react';
import { InfoTip } from './info-tip';
import { Input, Select } from './input';
export function Field({
  label,
  children,
  hint,
  help,
  htmlFor,
  helpId,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  help?: string;
  htmlFor?: string;
  helpId?: string;
}) {
  // A wrapping label would also label the tooltip button, so fields with help
  // point their label at the control explicitly instead.
  if (help)
    return (
      <div className="field">
        <span className="field-label">
          <label htmlFor={htmlFor}>{label}</label>
          <InfoTip text={help} id={helpId} />
        </span>
        {children}
        {hint && <small>{hint}</small>}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
  help?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  const id = useId();
  const helpId = useId();
  return (
    <Field label={label} hint={hint} help={help} htmlFor={id} helpId={helpId}>
      <Input
        id={id}
        aria-describedby={help ? helpId : undefined}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <Select
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
