import { z } from 'zod';
import {
  allocationDraftDataSchema,
  type AllocationDraftData,
} from '@roller-bay/shared/allocations';
import {
  nullableText,
  nullableNumber,
  widthValue,
  widthInput,
  lengthValue,
  lengthInput,
} from '@/lib/format';
export const allocationFormSchema = z.object({
  orderNumber: z.string(),
  requirements: z.array(
    z.object({
      id: z.string(),
      fabricColorId: z.string(),
      width: z.string(),
      length: z.string(),
      allowance: z.string(),
      quantity: z.string(),
    }),
  ),
  settings: z.object({
    edgeTrim: z.string(),
    remnantWidth: z.string(),
    remnantLength: z.string(),
  }),
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
export const emptyRequirement = () => ({
  id: crypto.randomUUID(),
  fabricColorId: '',
  width: '',
  length: '',
  allowance: '',
  quantity: '',
});
export function allocationToForm(data?: AllocationDraftData): AllocationForm {
  return {
    orderNumber: data?.orderNumber ?? '',
    requirements:
      data?.requirements.map((i) => ({
        id: i.id,
        fabricColorId: i.fabricColorId ?? '',
        width: widthInput(i.widthMm),
        length: lengthInput(i.lengthMm),
        allowance: lengthInput(i.lengthAllowanceMm),
        quantity: String(i.quantity ?? ''),
      })) ?? [],
    settings: {
      edgeTrim: widthInput(data?.settings.edgeTrimMm ?? null),
      remnantWidth: widthInput(data?.settings.minimumRemnantWidthMm ?? null),
      remnantLength: lengthInput(data?.settings.minimumRemnantLengthMm ?? null),
    },
    drops:
      data?.plan.drops.map((d) => ({
        stockItemId: d.stockItemId ?? '',
        length: lengthInput(d.lengthMm),
        items: d.items.map((i) => ({
          requirementId: i.requirementId,
          quantity: String(i.quantity ?? ''),
        })),
      })) ?? [],
  };
}
export function allocationFromForm(form: AllocationForm): AllocationDraftData {
  return allocationDraftDataSchema.parse({
    orderNumber: nullableText(form.orderNumber),
    requirements: form.requirements.map((r) => ({
      id: r.id,
      fabricColorId: nullableText(r.fabricColorId),
      widthMm: widthValue(r.width),
      lengthMm: lengthValue(r.length),
      lengthAllowanceMm: lengthValue(r.allowance),
      quantity: nullableNumber(r.quantity),
    })),
    settings: {
      edgeTrimMm: widthValue(form.settings.edgeTrim),
      minimumRemnantWidthMm: widthValue(form.settings.remnantWidth),
      minimumRemnantLengthMm: lengthValue(form.settings.remnantLength),
    },
    plan: {
      drops: form.drops.map((d) => ({
        stockItemId: nullableText(d.stockItemId),
        lengthMm: lengthValue(d.length),
        items: d.items.map((i) => ({
          requirementId: i.requirementId,
          quantity: nullableNumber(i.quantity),
        })),
      })),
    },
  });
}
