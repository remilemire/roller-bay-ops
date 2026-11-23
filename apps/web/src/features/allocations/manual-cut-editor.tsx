'use client';
import type { ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { CuttingPlanInput } from '@roller-bay/shared/allocations';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { fieldInput } from '@/lib/measurements';
import type { AllocationForm } from './allocation-form';
import { CutPlanEditor } from './cut-plan-editor';

export interface ManualCutEditorProps {
  requirements: {
    id: string;
    widthMm: number;
    lengthMm: number;
    quantity: number;
    label: string;
  }[];
  stockOptions: { value: string; label: string }[];
  units: MeasurementUnits;
  actions: (plan: CuttingPlanInput) => ReactNode;
  onDirty: () => void;
}
/** The request fixes the blinds; only cuts and their stock assignments are editable. */
export function ManualCutEditor({
  requirements,
  stockOptions,
  units,
  actions,
  onDirty,
}: ManualCutEditorProps) {
  const form = useForm<AllocationForm>({
    defaultValues: {
      workOrderId: '',
      requirements: requirements.map((r) => ({
        id: r.id,
        width: fieldInput(units, 'blindWidth', r.widthMm),
        length: fieldInput(units, 'finishedDrop', r.lengthMm),
        quantity: String(r.quantity),
        fabricColorId: '',
      })),
      cuts: [],
    },
  });
  const cuts = useWatch({ control: form.control, name: 'cuts' });
  const plan = {
    cuts: cuts.map((c) => ({
      stockItemId: c.stockItemId,
      items: c.items.map((i) => ({
        requirementId: i.requirementId,
        quantity: Number(i.quantity),
      })),
    })),
  };
  return (
    <>
      <CutPlanEditor
        form={form}
        units={units}
        stockOptions={stockOptions}
        requirementLabels={new Map(requirements.map((r) => [r.id, r.label]))}
        onChange={onDirty}
      />
      {actions(plan)}
    </>
  );
}
