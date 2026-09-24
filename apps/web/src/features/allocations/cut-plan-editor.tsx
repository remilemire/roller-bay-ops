'use client';
import {
  useFieldArray,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form';
import { Plus, Trash2, ArrowUp, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { fieldSuffix } from '@/lib/measurements';
import { type AllocationForm } from './allocation-form';
import { stockKey, lookupStock } from '@/features/stock-items';

export function CutPlanEditor({
  form,
  units,
  onChange,
  onGenerate,
  onValidate,
}: {
  form: UseFormReturn<AllocationForm>;
  units: MeasurementUnits;
  onChange: () => void;
  onGenerate: () => void;
  onValidate: () => void;
}) {
  const cuts = useFieldArray({
    control: form.control,
    name: 'cuts',
    keyName: 'formKey',
  });
  const values = useWatch({ control: form.control }) as AllocationForm;
  function setCuts(value: AllocationForm['cuts']) {
    form.setValue('cuts', value, { shouldDirty: true });
    onChange();
  }
  function addCut() {
    cuts.append({ stockItemId: '', items: [] });
    onChange();
  }
  // A generated plan replaces every cut, so an existing plan needs a nod first.
  function generate() {
    if (
      !cuts.fields.length ||
      window.confirm('Replace the current cuts with a generated plan?')
    )
      onGenerate();
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Cutting plan</h2>
          <p>
            Each cut comes from one stock item. Blinds are arranged left to
            right within it, and its length follows the longest blind plus the
            drop allowance.
          </p>
        </div>
        {cuts.fields.length > 0 && (
          <div className="inline-actions">
            <Button type="button" variant="outline" onClick={addCut}>
              <Plus size={16} />
              Add cut
            </Button>
            <Button type="button" variant="outline" onClick={generate}>
              <Sparkles size={16} />
              Generate plan
            </Button>
          </div>
        )}
      </div>
      <div className="panel-body">
        {!cuts.fields.length && (
          <div className="plan-start">
            <div className="plan-option">
              <Sparkles size={18} />
              <strong>Generate a plan</strong>
              <p>
                Proposes cuts from the required blinds and the stock on hand.
                You can adjust the result before saving.
              </p>
              <Button type="button" onClick={generate}>
                Generate plan
              </Button>
            </div>
            <span className="plan-or" aria-hidden="true">
              or
            </span>
            <div className="plan-option">
              <Plus size={18} />
              <strong>Build it by hand</strong>
              <p>Choose each stock item and assign blinds to it.</p>
              <Button type="button" variant="outline" onClick={addCut}>
                Add cut
              </Button>
            </div>
          </div>
        )}
        {cuts.fields.map((row, index) => {
          // Field-array changes can render before the watched values catch up.
          const cut = form.getValues(`cuts.${index}`) ?? row;
          const change = (next: typeof cut) => {
            setCuts(values.cuts.map((d, i) => (i === index ? next : d)));
            form.clearErrors(`cuts.${index}`);
          };
          const error = (name: FieldPath<AllocationForm>) =>
            form.getFieldState(name, form.formState).error?.message;
          return (
            <div className="plan-cut stack" key={row.formKey}>
              <div className="form-row-header">
                <strong>Cut {index + 1}</strong>
                <div className="inline-actions">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move cut ${index + 1} up`}
                    onClick={() => {
                      cuts.move(index, index - 1);
                      onChange();
                    }}
                  >
                    <ArrowUp size={15} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove cut ${index + 1}`}
                    onClick={() => {
                      cuts.remove(index);
                      onChange();
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
              <div className="form-grid">
                <Lookup
                  label={`Stock item · cut ${index + 1}`}
                  value={cut.stockItemId}
                  onChange={(v) => change({ ...cut, stockItemId: v })}
                  queryKey={[...stockKey, units.rollWidth]}
                  load={lookupStock(units.rollWidth)}
                  error={error(`cuts.${index}.stockItemId`)}
                />
              </div>
              <hr className="divider" />
              {cut.items.map((assignment, ai) => (
                <div className="form-grid" key={ai}>
                  <ChoiceField
                    label={`Blind · cut ${index + 1}, position ${ai + 1}`}
                    value={assignment.requirementId}
                    onChange={(v) =>
                      change({
                        ...cut,
                        items: cut.items.map((item, i) =>
                          i === ai ? { ...item, requirementId: v } : item,
                        ),
                      })
                    }
                    error={error(`cuts.${index}.items.${ai}.requirementId`)}
                    options={values.requirements.map((r, i) => ({
                      value: r.id,
                      label: `Blind ${i + 1} · ${r.width || '?'} ${fieldSuffix(units, 'blindWidth')} × ${r.length || '?'} ${fieldSuffix(units, 'finishedDrop')}`,
                    }))}
                  />
                  <div
                    className="inline-actions"
                    style={{ alignItems: 'flex-end' }}
                  >
                    <TextField
                      label="Quantity in this cut"
                      type="number"
                      value={assignment.quantity}
                      error={error(`cuts.${index}.items.${ai}.quantity`)}
                      onChange={(v) =>
                        change({
                          ...cut,
                          items: cut.items.map((item, i) =>
                            i === ai ? { ...item, quantity: v } : item,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove assignment ${ai + 1} from cut ${index + 1}`}
                      onClick={() =>
                        change({
                          ...cut,
                          items: cut.items.filter((_, i) => i !== ai),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !values.requirements.some(
                    (r) => !cut.items.some((i) => i.requirementId === r.id),
                  )
                }
                onClick={() => {
                  const next = values.requirements.find(
                    (r) => !cut.items.some((i) => i.requirementId === r.id),
                  );
                  if (next)
                    change({
                      ...cut,
                      items: [
                        ...cut.items,
                        { requirementId: next.id, quantity: '' },
                      ],
                    });
                }}
              >
                Assign a blind
              </Button>
            </div>
          );
        })}
        {cuts.fields.length > 0 && (
          <Button type="button" variant="outline" onClick={() => onValidate()}>
            <Check size={16} />
            Validate plan
          </Button>
        )}
      </div>
    </section>
  );
}
