import { useId, type ReactNode } from 'react';
import { Input, Select } from './input';
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
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
  disabled = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint}>
      <Input
        id={id}
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
