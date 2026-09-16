'use client';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { Plus, Trash2, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { type AllocationForm, emptyRequirement } from './allocation-form';
import {
  catalogKey,
  lookupColors,
} from '@/features/fabric-catalog/catalog.api';

export function RequirementsEditor({
  form,
  onChange,
}: {
  form: UseFormReturn<AllocationForm>;
  onChange: () => void;
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
      'drops',
      values.drops.map((d) => ({
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
          <h2>Required blinds</h2>
          <p>Finished sizes, quantities, and any extra length for the drop.</p>
        </div>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            requirements.append(emptyRequirement());
            onChange();
          }}
        >
          <Plus size={16} />
          Add blind
        </Button>
      </div>
      <div className="panel-body">
        {!requirements.fields.length && (
          <p className="muted">Add your first blind to start planning.</p>
        )}
        {requirements.fields.map((row, index) => {
          const r = form.getValues(`requirements.${index}`) ?? row;
          const change = (key: keyof typeof r, value: string) => {
            form.setValue(`requirements.${index}.${key}`, value, {
              shouldDirty: true,
            });
            onChange();
          };
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
                queryKey={[...catalogKey, 'colors']}
                load={lookupColors}
              />
              <TextField
                label="Width (in)"
                type="number"
                value={r.width}
                onChange={(v) => change('width', v)}
              />
              <TextField
                label="Finished drop (yd)"
                type="number"
                value={r.length}
                onChange={(v) => change('length', v)}
              />
              <TextField
                label="Extra drop allowance (yd)"
                type="number"
                value={r.allowance}
                onChange={(v) => change('allowance', v)}
                hint="Enter 0 when no extra length is needed."
              />
              <TextField
                label="Quantity"
                type="number"
                value={r.quantity}
                onChange={(v) => change('quantity', v)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
