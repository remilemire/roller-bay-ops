import { z } from 'zod';
import {
  allocationDraftInputSchema,
  type AllocationDraftInput,
} from '@roller-bay/shared/allocations';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { nullableText, nullableNumber } from '@/lib/format';
import { fieldInput, fieldValue } from '@/lib/measurements';
export const allocationFormSchema = z.object({
  orderNumber: z.string(),
  requirements: z.array(
    z.object({
      id: z.string(),
      fabricColorId: z.string(),
      width: z.string(),
      length: z.string(),
      quantity: z.string(),
    }),
  ),
  drops: z.array(
    z.object({
      stockItemId: z.string(),
      length: z.string(),
      items: z.array(
        z.object({ requirementId: z.string(), quantity: z.string() }),
      ),
    }),
  ),
});
export type AllocationForm = z.infer<typeof allocationFormSchema>;
// This ID survives draft saves and is referenced by cut assignments; it is
// separate from React Hook Form's transient field-array key.
export const emptyRequirement = () => ({
  id: crypto.randomUUID(),
  fabricColorId: '',
  width: '',
  length: '',
  quantity: '',
});
// Form strings are expressed in the given units; callers must convert back
// with the same units so a saved value never drifts.
export function allocationToForm(
  data: AllocationDraftInput | undefined,
  units: MeasurementUnits,
): AllocationForm {
  return {
    orderNumber: data?.orderNumber ?? '',
    requirements:
      data?.requirements.map((i) => ({
        id: i.id,
        fabricColorId: i.fabricColorId ?? '',
        width: fieldInput(units, 'blindWidth', i.widthMm),
        length: fieldInput(units, 'finishedDrop', i.lengthMm),
        quantity: String(i.quantity ?? ''),
      })) ?? [],
    drops:
      data?.plan.drops.map((d) => ({
        stockItemId: d.stockItemId ?? '',
        length: fieldInput(units, 'dropLength', d.lengthMm),
        items: d.items.map((i) => ({
          requirementId: i.requirementId,
          quantity: String(i.quantity ?? ''),
        })),
      })) ?? [],
  };
}
export function allocationFromForm(
  form: AllocationForm,
  units: MeasurementUnits,
): AllocationDraftInput {
  return allocationDraftInputSchema.parse({
    orderNumber: nullableText(form.orderNumber),
    requirements: form.requirements.map((r) => ({
      id: r.id,
      fabricColorId: nullableText(r.fabricColorId),
      widthMm: fieldValue(units, 'blindWidth', r.width),
      lengthMm: fieldValue(units, 'finishedDrop', r.length),
      quantity: nullableNumber(r.quantity),
    })),
    plan: {
      drops: form.drops.map((d) => ({
        stockItemId: nullableText(d.stockItemId),
        lengthMm: fieldValue(units, 'dropLength', d.length),
        items: d.items.map((i) => ({
          requirementId: i.requirementId,
          quantity: nullableNumber(i.quantity),
        })),
      })),
    },
  });
}
