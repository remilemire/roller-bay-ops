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
  planningDisabled,
  onOptimize,
  onValidate,
}: {
  form: UseFormReturn<AllocationForm>;
  units: MeasurementUnits;
  onChange: () => void;
  // Previews check the draft revision, which an in-flight autosave advances.
  planningDisabled: boolean;
  onOptimize: () => void;
  onValidate: () => void;
}) {
  const drops = useFieldArray({
    control: form.control,
    name: 'drops',
    keyName: 'formKey',
  });
  const values = useWatch({ control: form.control }) as AllocationForm;
  function setDrops(value: AllocationForm['drops']) {
    form.setValue('drops', value, { shouldDirty: true });
    onChange();
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Cutting plan</h2>
          <p>
            Each drop belongs to one stock item. Blinds are arranged left to
            right.
          </p>
        </div>
        <div className="inline-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              drops.append({ stockItemId: '', length: '', items: [] });
              onChange();
            }}
          >
            <Plus size={16} />
            Add drop
          </Button>
          <Button
            type="button"
            disabled={planningDisabled}
            onClick={() => onOptimize()}
          >
            <Sparkles size={16} />
            Optimize
          </Button>
        </div>
      </div>
      <div className="panel-body">
        {!drops.fields.length && (
          <p className="muted">
            Add drops manually, or optimize after entering the requirements and
            cutting rules.
          </p>
        )}
        {drops.fields.map((row, index) => {
          // Field-array changes can render before the watched values catch up.
          const drop = form.getValues(`drops.${index}`) ?? row;
          const change = (next: typeof drop) =>
            setDrops(values.drops.map((d, i) => (i === index ? next : d)));
          return (
            <div className="plan-drop" key={row.formKey}>
              <div className="form-row-header">
                <strong>Drop {index + 1}</strong>
                <div className="inline-actions">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move drop ${index + 1} up`}
                    onClick={() => {
                      drops.move(index, index - 1);
                      onChange();
                    }}
                  >
                    <ArrowUp size={15} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove drop ${index + 1}`}
                    onClick={() => {
                      drops.remove(index);
                      onChange();
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
              <div className="form-grid">
                <Lookup
                  label={`Stock item · drop ${index + 1}`}
                  value={drop.stockItemId}
                  onChange={(v) => change({ ...drop, stockItemId: v })}
                  queryKey={[...stockKey, units.rollWidth]}
                  load={lookupStock(units.rollWidth)}
                />
                <TextField
                  label={`Drop length (${fieldSuffix(units, 'dropLength')})`}
                  type="number"
                  value={drop.length}
                  onChange={(v) => change({ ...drop, length: v })}
                />
              </div>
              <hr className="divider" />
              {drop.items.map((assignment, ai) => (
                <div
                  className="form-grid"
                  key={ai}
                  style={{ marginBottom: 12 }}
                >
                  <ChoiceField
                    label={`Blind · drop ${index + 1}, position ${ai + 1}`}
                    value={assignment.requirementId}
                    onChange={(v) =>
                      change({
                        ...drop,
                        items: drop.items.map((item, i) =>
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
                      label="Quantity in this drop"
                      type="number"
                      value={assignment.quantity}
                      onChange={(v) =>
                        change({
                          ...drop,
                          items: drop.items.map((item, i) =>
                            i === ai ? { ...item, quantity: v } : item,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove assignment ${ai + 1} from drop ${index + 1}`}
                      onClick={() =>
                        change({
                          ...drop,
                          items: drop.items.filter((_, i) => i !== ai),
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
                    (r) => !drop.items.some((i) => i.requirementId === r.id),
                  )
                }
                onClick={() => {
                  const next = values.requirements.find(
                    (r) => !drop.items.some((i) => i.requirementId === r.id),
                  );
                  if (next)
                    change({
                      ...drop,
                      items: [
                        ...drop.items,
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
        <Button
          type="button"
          variant="outline"
          disabled={planningDisabled}
          onClick={() => onValidate()}
        >
          <Check size={16} />
          Validate plan
        </Button>
      </div>
    </section>
  );
}
