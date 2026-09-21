'use client';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { Plus, Trash2, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { fieldSuffix, measurementHelp } from '@/lib/measurements';
import { type AllocationForm, emptyRequirement } from './allocation-form';
import {
  catalogKey,
  lookupColors,
} from '@/features/fabric-catalog/catalog.api';

/** The work order's blinds. They are the order's record, saved by `actions`. */
export function RequirementsEditor({
  form,
  units,
  onChange,
  frozen,
  actions,
}: {
  form: UseFormReturn<AllocationForm>;
  units: MeasurementUnits;
  onChange: () => void;
  /** Why the blinds cannot be edited now, if they cannot. */
  frozen?: string;
  actions?: React.ReactNode;
}) {
  const requirements = useFieldArray({
    control: form.control,
    name: 'requirements',
    keyName: 'formKey',
  });
  const values = useWatch({ control: form.control }) as AllocationForm;
  function removeRequirement(index: number) {
    const id = values.requirements[index]!.id;
    requirements.remove(index);
    form.setValue(
      'cuts',
      values.cuts.map((d) => ({
        ...d,
        items: d.items.filter((i) => i.requirementId !== id),
      })),
      { shouldDirty: true },
    );
    onChange();
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Blinds</h2>
          <p>
            {frozen ??
              "The order's blinds, in finished sizes. The configured drop allowance is added automatically."}
          </p>
        </div>
        <div className="inline-actions">
          <Button
            variant="outline"
            type="button"
            disabled={!!frozen}
            onClick={() => {
              requirements.append(emptyRequirement());
              onChange();
            }}
          >
            <Plus size={16} />
            Add blind
          </Button>
          {actions}
        </div>
      </div>
      <fieldset
        className="panel-body"
        disabled={!!frozen}
        style={{ border: 0, margin: 0 }}
      >
        {!requirements.fields.length && !frozen && (
          <p className="muted">Add the order&apos;s first blind.</p>
        )}
        {requirements.fields.map((row, index) => {
          // Field-array changes can render before the watched values catch up.
          const r = form.getValues(`requirements.${index}`) ?? row;
          const change = (key: keyof typeof r, value: string) => {
            form.setValue(`requirements.${index}.${key}`, value, {
              shouldDirty: true,
            });
            form.clearErrors(`requirements.${index}.${key}`);
            onChange();
          };
          const error = (key: keyof typeof r) =>
            form.getFieldState(`requirements.${index}.${key}`, form.formState)
              .error?.message;
          return (
            <div className="form-row" key={row.formKey}>
              <div className="form-row-header">
                <strong>Blind {index + 1}</strong>
                <div className="inline-actions">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move blind ${index + 1} up`}
                    onClick={() => {
                      requirements.move(index, index - 1);
                      onChange();
                    }}
                  >
                    <ArrowUp size={15} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove blind ${index + 1}`}
                    onClick={() => removeRequirement(index)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
              <Lookup
                label={`Color · blind ${index + 1}`}
                value={r.fabricColorId}
                onChange={(v) => change('fabricColorId', v)}
                error={error('fabricColorId')}
                queryKey={[...catalogKey, 'colors']}
                load={lookupColors}
              />
              <TextField
                label={`Width (${fieldSuffix(units, 'blindWidth')})`}
                type="number"
                value={r.width}
                onChange={(v) => change('width', v)}
                error={error('width')}
              />
              <TextField
                label={`Finished drop (${fieldSuffix(units, 'finishedDrop')})`}
                help={measurementHelp.finishedDrop}
                type="number"
                value={r.length}
                onChange={(v) => change('length', v)}
                error={error('length')}
              />
              <TextField
                label="Quantity"
                type="number"
                value={r.quantity}
                onChange={(v) => change('quantity', v)}
                error={error('quantity')}
              />
            </div>
          );
        })}
      </fieldset>
    </section>
  );
}
