import { SlidingSelection } from './sliding-selection';
import { cn } from '@/lib/utils';

/** Exclusive filters and views, kept in URL state by the owning screen. */
export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <SlidingSelection className="tabs" label={label} value={value}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={cn('tab', value === option.value && 'active')}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </SlidingSelection>
  );
}
