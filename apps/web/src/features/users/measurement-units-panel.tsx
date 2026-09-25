'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  defaultMeasurementUnits,
  lengthUnitSchema,
  lengthUnits,
  measurementFields,
  type MeasurementField,
  type UpdateMeasurementUnits,
} from '@roller-bay/shared/users';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/feedback';
import { Select } from '@/components/ui/input';
import { sessionKey } from '@/features/auth';
import { helpFor, unitNames } from '@/lib/measurements';
import { useMeasurementUnits } from './use-measurement-units';
import { updateMeasurementUnits } from './users.api';

const fieldLabels: Record<MeasurementField, string> = {
  rollWidth: 'Roll width',
  rollLength: 'Roll length',
  blindWidth: 'Blind width',
  finishedDrop: 'Finished drop',
  dropAllowance: 'Drop allowance',
  cutLength: 'Cut length',
  edgeTrim: 'Edge trim',
  minimumRemnantWidth: 'Minimum reusable width',
  minimumRemnantLength: 'Minimum reusable length',
  thickness: 'Fabric thickness',
  radialDepth: 'Radial depth',
  tubeDiameter: 'Tube outer diameter',
};

const sections: { title: string; fields: MeasurementField[] }[] = [
  { title: 'Stock dimensions', fields: ['rollWidth', 'rollLength'] },
  { title: 'Blind dimensions', fields: ['blindWidth', 'finishedDrop'] },
  {
    title: 'Cutting & remnants',
    fields: [
      'dropAllowance',
      'cutLength',
      'edgeTrim',
      'minimumRemnantWidth',
      'minimumRemnantLength',
    ],
  },
  {
    title: 'Roll measurements',
    fields: ['thickness', 'radialDepth', 'tubeDiameter'],
  },
];

export function MeasurementUnitsPanel() {
  const units = useMeasurementUnits();
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (patch: UpdateMeasurementUnits) =>
      updateMeasurementUnits(patch),
    // The selects show the session's value, so the server response is what
    // updates them; a failed change visibly falls back to the saved unit.
    onSuccess: (user) => client.setQueryData(sessionKey, user),
  });
  const isDefault = measurementFields.every(
    (field) => units[field] === defaultMeasurementUnits[field],
  );
  return (
    <section className="panel" aria-labelledby="measurements-heading">
      <div className="panel-heading">
        <div>
          <h2 id="measurements-heading">Measurement units</h2>
          <p>Choose the unit for entering and reading each measurement.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDefault || change.isPending}
          onClick={() => change.mutate(defaultMeasurementUnits)}
        >
          Reset to defaults
        </Button>
      </div>
      <div className="panel-body">
        <fieldset disabled={change.isPending} className="form-fieldset">
          {sections.map((section) => (
            <div className="form-section" key={section.title}>
              <h3>{section.title}</h3>
              <div className="form-grid">
                {section.fields.map((field) => (
                  <Field
                    label={fieldLabels[field]}
                    help={helpFor(field)}
                    htmlFor={`measurement-unit-${field}`}
                    helpId={`measurement-unit-${field}-help`}
                    key={field}
                  >
                    <Select
                      id={`measurement-unit-${field}`}
                      aria-describedby={
                        helpFor(field)
                          ? `measurement-unit-${field}-help`
                          : undefined
                      }
                      value={units[field]}
                      onChange={(event) =>
                        change.mutate({
                          [field]: lengthUnitSchema.parse(event.target.value),
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
              </div>
            </div>
          ))}
        </fieldset>
        {change.error && <ErrorNotice error={change.error} />}
        <p className="muted">Saved to your account.</p>
      </div>
    </section>
  );
}
