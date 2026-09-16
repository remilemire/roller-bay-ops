'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  lengthUnitSchema,
  lengthUnits,
  measurementFields,
  type LengthUnit,
  type MeasurementField,
} from '@roller-bay/shared/users';
import { Field } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/feedback';
import { Select } from '@/components/ui/input';
import { sessionKey } from '@/features/auth/auth.queries';
import { unitNames } from '@/lib/measurements';
import { useMeasurementUnits } from './use-measurement-units';
import { updateMeasurementUnits } from './users.api';

const fieldLabels: Record<MeasurementField, string> = {
  rollWidth: 'Roll width',
  rollLength: 'Roll length',
  blindWidth: 'Blind width',
  finishedDrop: 'Finished drop',
  dropAllowance: 'Drop allowance',
  dropLength: 'Cut drop length',
  edgeTrim: 'Edge trim',
  minimumRemnantWidth: 'Minimum reusable width',
  minimumRemnantLength: 'Minimum reusable length',
  thickness: 'Fabric thickness',
  radialDepth: 'Radial depth',
};

export function MeasurementUnitsPanel() {
  const units = useMeasurementUnits();
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (input: { field: MeasurementField; unit: LengthUnit }) =>
      updateMeasurementUnits({ [input.field]: input.unit }),
    // The selects show the session's value, so the server response is what
    // updates them; a failed change visibly falls back to the saved unit.
    onSuccess: (user) => client.setQueryData(sessionKey, user),
  });
  return (
    <section className="panel" aria-labelledby="measurements-heading">
      <div className="panel-heading">
        <div>
          <h2 id="measurements-heading">Measurements</h2>
          <p>Choose the unit for entering and reading each measurement.</p>
        </div>
      </div>
      <div className="panel-body">
        <fieldset
          className="form-grid"
          disabled={change.isPending}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          {measurementFields.map((field) => (
            <Field label={fieldLabels[field]} key={field}>
              <Select
                value={units[field]}
                onChange={(event) =>
                  change.mutate({
                    field,
                    unit: lengthUnitSchema.parse(event.target.value),
                  })
                }
              >
                {lengthUnits.map((unit) => (
                  <option value={unit} key={unit}>
                    {unitNames[unit]}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <div>
            <div className="detail-label">Tube outer diameter</div>
            <div className="detail-value">Millimetres, multiples of 5</div>
          </div>
        </fieldset>
        {change.error && <ErrorNotice error={change.error} />}
        <p className="muted">
          Saved to your account. Records keep millimetres to 0.001 mm.
        </p>
      </div>
    </section>
  );
}
