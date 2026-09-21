import { it, expect } from 'vitest';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  allocationFieldName,
  allocationFromForm,
  allocationToForm,
  emptyRequirement,
  linesToRows,
  rowsToLines,
} from './allocation-form';
const units = defaultMeasurementUnits;
const workOrderId = crypto.randomUUID();
it("sends the allocation's half of the form: the order and its plan, never the blinds", () => {
  const r = emptyRequirement();
  const data = allocationFromForm({
    workOrderId,
    requirements: [{ ...r, width: '22', length: '54', quantity: '2' }],
    cuts: [{ stockItemId: '', items: [{ requirementId: r.id, quantity: '' }] }],
  });
  expect(data).toEqual({
    workOrderId,
    plan: {
      cuts: [
        { stockItemId: null, items: [{ requirementId: r.id, quantity: null }] },
      ],
    },
  });
  expect(allocationFromForm(allocationToForm(data, [], units))).toEqual(data);
  // An allocation plans an order, so a form without one has nothing to send.
  expect(() =>
    allocationFromForm({ workOrderId: '', requirements: [], cuts: [] }),
  ).toThrow();
});
it("converts the order's blinds in the user's units, and refuses a half-entered one", () => {
  const r = emptyRequirement();
  const inchDrops: MeasurementUnits = {
    ...defaultMeasurementUnits,
    finishedDrop: 'in',
    dropAllowance: 'in',
    edgeTrim: 'mm',
    cutLength: 'm',
  };
  const fabricColorId = crypto.randomUUID();
  const row = { ...r, fabricColorId, width: '22', length: '72', quantity: '1' };
  const lines = rowsToLines([row], inchDrops);
  expect(lines).toEqual([
    { id: r.id, fabricColorId, widthMm: 558.8, lengthMm: 1828.8, quantity: 1 },
  ]);
  expect(linesToRows(lines, inchDrops)).toEqual([row]);
  // A blind is saved whole; the refusal names the row and field at fault.
  expect(() => rowsToLines([{ ...row, width: '' }], inchDrops)).toThrow(
    expect.objectContaining({
      issues: [expect.objectContaining({ path: ['lines', 0, 'widthMm'] })],
    }),
  );
});
it('drops the stored cut length from the form', () => {
  // A saved draft or generated plan carries a derived length; the form
  // neither shows nor resubmits it.
  const stored = {
    workOrderId,
    plan: { cuts: [{ stockItemId: null, lengthMm: 2743.2, items: [] }] },
  };
  expect(allocationToForm(stored, [], units)).toEqual({
    workOrderId,
    requirements: [],
    cuts: [{ stockItemId: '', items: [] }],
  });
});
it('places API and plan-validator issues on the field that fixes them', () => {
  const r = emptyRequirement();
  const stockItemId = crypto.randomUUID();
  const form = {
    workOrderId: '',
    requirements: [emptyRequirement(), r],
    cuts: [
      { stockItemId: '', items: [] },
      { stockItemId, items: [{ requirementId: r.id, quantity: '1' }] },
    ],
  };
  const name = (path: string) => allocationFieldName(path, form);
  expect(name('workOrderId')).toBe('workOrderId');
  // A refused save of the blinds names the row, and sometimes its field.
  expect(name('lines.1.widthMm')).toBe('requirements.1.width');
  expect(name('lines.1.lengthMm')).toBe('requirements.1.length');
  expect(name('lines.0.fabricColorId')).toBe('requirements.0.fabricColorId');
  expect(name('lines.1')).toBe('requirements.1.quantity');
  expect(name(`context.requirements.${r.id}`)).toBe('requirements.1.quantity');
  expect(name(`context.stockItems.${stockItemId}`)).toBe('cuts.1.stockItemId');
  expect(name('plan.cuts.0')).toBe('cuts.0.stockItemId');
  expect(name('plan.cuts.1.lengthMm')).toBe('cuts.1.stockItemId');
  expect(name('plan.cuts.1.items.0')).toBe('cuts.1.items.0.requirementId');
  expect(name('plan.cuts.1.items.0.quantity')).toBe('cuts.1.items.0.quantity');
  // Issues about the whole list or unknown records stay in the notice.
  expect(name('lines')).toBeNull();
  expect(name(`context.requirements.${crypto.randomUUID()}`)).toBeNull();
});
