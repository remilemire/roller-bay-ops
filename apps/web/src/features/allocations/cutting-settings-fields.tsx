import type { MeasurementUnits } from '@roller-bay/shared/users';
import { TextField } from '@/components/ui/field';
import { fieldSuffix } from '@/lib/measurements';
import type { AllocationForm } from './allocation-form';
export function CuttingSettingsFields({
  units,
  value,
  onChange,
}: {
  units: MeasurementUnits;
  value: AllocationForm['settings'];
  onChange: (value: AllocationForm['settings']) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Cutting rules</h2>
      </div>
      <div className="panel-body form-grid">
        <TextField
          label={`Trim per outside edge (${fieldSuffix(units, 'edgeTrim')})`}
          type="number"
          value={value.edgeTrim}
          onChange={(v) => onChange({ ...value, edgeTrim: v })}
        />
        <TextField
          label={`Minimum reusable width (${fieldSuffix(units, 'minimumRemnantWidth')})`}
          type="number"
          value={value.remnantWidth}
          onChange={(v) => onChange({ ...value, remnantWidth: v })}
        />
        <TextField
          label={`Minimum reusable length (${fieldSuffix(units, 'minimumRemnantLength')})`}
          type="number"
          value={value.remnantLength}
          onChange={(v) => onChange({ ...value, remnantLength: v })}
        />
        <p className="muted">
          Orientation stays fixed. Drops are cut first, with straight cuts and
          trimmed outside edges.
        </p>
      </div>
    </section>
  );
}
