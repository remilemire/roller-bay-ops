'use client';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { Plus, Trash2, ArrowUp, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { fieldSuffix } from '@/lib/measurements';
import { type AllocationForm } from './allocation-form';
import { stockKey, lookupStock } from '@/features/stock-items/stock-items.api';

export function CutPlanEditor({
  form,
  units,
  onChange,
  onOptimize,
  onValidate,
}: {
  form: UseFormReturn<AllocationForm>;
  units: MeasurementUnits;
  onChange: () => void;
  onOptimize: () => void;
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
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Cutting plan</h2>
          <p>
            Each cut belongs to one stock item. Blinds are arranged left to
            right.
          </p>
        </div>
        <div className="inline-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              cuts.append({ stockItemId: '', length: '', items: [] });
              onChange();
            }}
          >
            <Plus size={16} />
            Add cut
          </Button>
          <Button type="button" onClick={() => onOptimize()}>
            <Sparkles size={16} />
            Optimize
          </Button>
        </div>
      </div>
      <div className="panel-body">
        {!cuts.fields.length && (
          <p className="muted">
            Add cuts manually, or optimize after entering the requirements and
            cutting rules.
          </p>
        )}
        {cuts.fields.map((row, index) => {
          // Field-array changes can render before the watched values catch up.
          const cut = form.getValues(`cuts.${index}`) ?? row;
          const change = (next: typeof cut) =>
            setCuts(values.cuts.map((d, i) => (i === index ? next : d)));
          return (
            <div className="plan-cut" key={row.formKey}>
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
                />
                <TextField
                  label={`Cut length (${fieldSuffix(units, 'cutLength')})`}
                  type="number"
                  value={cut.length}
                  onChange={(v) => change({ ...cut, length: v })}
                />
              </div>
              <hr className="divider" />
              {cut.items.map((assignment, ai) => (
                <div
                  className="form-grid"
                  key={ai}
                  style={{ marginBottom: 12 }}
                >
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
                    options={values.requirements.map((r, i) => ({
                      value: r.id,
                      label: `Blind ${i + 1} · ${r.width || '?'} ${fieldSuffix(units, 'blindWidth')} × ${r.length || '?'} ${fieldSuffix(units, 'finishedDrop')}`,
                    }))}
                  />
                  <div className="inline-actions">
                    <TextField
                      label="Quantity in this cut"
                      type="number"
                      value={assignment.quantity}
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
        <Button type="button" variant="outline" onClick={() => onValidate()}>
          <Check size={16} />
          Validate plan
        </Button>
      </div>
    </section>
  );
}
