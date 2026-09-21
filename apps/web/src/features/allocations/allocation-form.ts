import { z } from 'zod';
import type { FieldPath } from 'react-hook-form';
import {
  allocationDraftInputSchema,
  type AllocationDraftInput,
} from '@roller-bay/shared/allocations';
import {
  workOrderLineSchema,
  type WorkOrderLine,
} from '@roller-bay/shared/work-orders';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { nullableText, nullableNumber } from '@/lib/format';
import { fieldInput, fieldValue } from '@/lib/measurements';
// One form, two records: `requirements` are the work order's blinds, saved to
// the order; `workOrderId` and `cuts` are the allocation's plan for them.
export const allocationFormSchema = z.object({
  workOrderId: z.string(),
  requirements: z.array(
    z.object({
      id: z.string(),
      fabricColorId: z.string(),
      width: z.string(),
      length: z.string(),
      quantity: z.string(),
    }),
  ),
  // Cut length is derived by the API from the assigned blinds, not entered.
  cuts: z.array(
    z.object({
      stockItemId: z.string(),
      items: z.array(
        z.object({ requirementId: z.string(), quantity: z.string() }),
      ),
    }),
  ),
});
export type AllocationForm = z.infer<typeof allocationFormSchema>;
const UUID = '[0-9a-f-]{36}';
const FIELD_PATHS: [
  RegExp,
  (match: RegExpMatchArray, form: AllocationForm) => string | null,
][] = [
  [/^workOrderId$/, () => 'workOrderId'],
  // A refused save of the blinds names the row, and sometimes its field.
  [
    /^lines\.(\d+)(?:\.(fabricColorId|widthMm|lengthMm|quantity))?$/,
    ([, row, key]) =>
      `requirements.${row}.${{ widthMm: 'width', lengthMm: 'length' }[key ?? ''] ?? key ?? 'quantity'}`,
  ],
  [
    /^requirements\.(\d+)\.(fabricColorId|width|length|quantity)(Mm)?$/,
    ([, row, key]) => `requirements.${row}.${key}`,
  ],
  // The plan validator reports quantity mismatches against the requirement ID.
  [
    new RegExp(`^requirements\\.(${UUID})$`),
    ([, id], form) => {
      const row = form.requirements.findIndex((r) => r.id === id);
      return row < 0 ? null : `requirements.${row}.quantity`;
    },
  ],
  [
    new RegExp(`^stockItems\\.(${UUID})$`),
    ([, id], form) => {
      const cut = form.cuts.findIndex((c) => c.stockItemId === id);
      return cut < 0 ? null : `cuts.${cut}.stockItemId`;
    },
  ],
  // Whole-cut problems (width, derived length) are fixed by changing its stock.
  [
    /^plan\.cuts\.(\d+)(\.stockItemId|\.lengthMm)?$/,
    ([, cut]) => `cuts.${cut}.stockItemId`,
  ],
  [
    /^plan\.cuts\.(\d+)\.items\.(\d+)(?:\.(requirementId|quantity))?$/,
    ([, cut, item, key]) =>
      `cuts.${cut}.items.${item}.${key ?? 'requirementId'}`,
  ],
];
/**
 * The form field that shows an issue reported against the API payload or the
 * plan validator's context, or null when the issue belongs to no single field.
 */
export function allocationFieldName(
  path: string,
  form: AllocationForm,
): FieldPath<AllocationForm> | null {
  const local = path.replace(/^(data|context)\./, '');
  for (const [pattern, name] of FIELD_PATHS) {
    const match = local.match(pattern);
    if (match) return name(match, form) as FieldPath<AllocationForm> | null;
  }
  return null;
}
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
export const linesToRows = (
  lines: readonly WorkOrderLine[],
  units: MeasurementUnits,
): AllocationForm['requirements'] =>
  lines.map((line) => ({
    id: line.id,
    fabricColorId: line.fabricColorId,
    width: fieldInput(units, 'blindWidth', line.widthMm),
    length: fieldInput(units, 'finishedDrop', line.lengthMm),
    quantity: String(line.quantity),
  }));
const lineList = z.object({ lines: z.array(workOrderLineSchema) });
/** The blinds as the order stores them; throws on a half-entered row. */
export const rowsToLines = (
  rows: AllocationForm['requirements'],
  units: MeasurementUnits,
): WorkOrderLine[] =>
  lineList.parse({
    lines: rows.map((row) => ({
      id: row.id,
      fabricColorId: nullableText(row.fabricColorId),
      widthMm: fieldValue(units, 'blindWidth', row.width),
      lengthMm: fieldValue(units, 'finishedDrop', row.length),
      quantity: nullableNumber(row.quantity),
    })),
  }).lines;
export function allocationToForm(
  data: AllocationDraftInput | undefined,
  lines: readonly WorkOrderLine[],
  units: MeasurementUnits,
): AllocationForm {
  return {
    workOrderId: data?.workOrderId ?? '',
    requirements: linesToRows(lines, units),
    cuts:
      data?.plan.cuts.map((d) => ({
        stockItemId: d.stockItemId ?? '',
        items: d.items.map((i) => ({
          requirementId: i.requirementId,
          quantity: String(i.quantity ?? ''),
        })),
      })) ?? [],
  };
}
/** The allocation's half of the form: the order it plans, and the plan. */
export function allocationFromForm(form: AllocationForm): AllocationDraftInput {
  return allocationDraftInputSchema.parse({
    workOrderId: form.workOrderId,
    plan: {
      cuts: form.cuts.map((d) => ({
        stockItemId: nullableText(d.stockItemId),
        items: d.items.map((i) => ({
          requirementId: i.requirementId,
          quantity: nullableNumber(i.quantity),
        })),
      })),
    },
  });
}
