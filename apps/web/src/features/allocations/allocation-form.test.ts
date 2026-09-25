import { it, expect } from 'vitest';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  allocationFieldName,
  allocationFromForm,
  allocationToForm,
  blindTotal,
  emptyRequirement,
} from './allocation-form';
const units = defaultMeasurementUnits;
const workOrderId = crypto.randomUUID();
it('sends the whole allocation: its order, its blinds and its plan', () => {
  const r = emptyRequirement();
  const data = allocationFromForm(
    {
      workOrderId,
      requirements: [{ ...r, width: '22', length: '54', quantity: '2' }],
      cuts: [
        { stockItemId: '', items: [{ requirementId: r.id, quantity: '' }] },
      ],
    },
    units,
  );
  expect(data).toEqual({
    workOrderId,
    requirements: [
      {
        id: r.id,
        fabricColorId: null,
        widthMm: 558.8,
        lengthMm: 1371.6,
        quantity: 2,
      },
    ],
    plan: {
      cuts: [
        { stockItemId: null, items: [{ requirementId: r.id, quantity: null }] },
      ],
    },
  });
  expect(allocationFromForm(allocationToForm(data, units), units)).toEqual(
    data,
  );
  // An allocation is for an order, so a form without one has nothing to send.
  expect(() =>
    allocationFromForm({ workOrderId: '', requirements: [], cuts: [] }, units),
  ).toThrow();
});
it("converts blinds in the user's units, and keeps a half-entered one blank", () => {
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
  const form = { workOrderId, requirements: [row], cuts: [] };
  const data = allocationFromForm(form, inchDrops);
  expect(data.requirements).toEqual([
    { id: r.id, fabricColorId, widthMm: 558.8, lengthMm: 1828.8, quantity: 1 },
  ]);
  expect(allocationToForm(data, inchDrops)).toEqual(form);
  // A draft may hold an unfinished blind; blanks stay blank, never zero.
  const half = allocationFromForm(
    { ...form, requirements: [{ ...row, width: '', quantity: '' }] },
    inchDrops,
  );
  expect(half.requirements[0]).toMatchObject({ widthMm: null, quantity: null });
  expect(allocationToForm(half, inchDrops).requirements[0]).toMatchObject({
    width: '',
    quantity: '',
  });
});
it('adds up the blinds entered, skipping unfinished counts', () => {
  const rows = [
    { ...emptyRequirement(), quantity: '2' },
    { ...emptyRequirement(), quantity: '' },
    { ...emptyRequirement(), quantity: '3' },
  ];
  expect(blindTotal({ workOrderId, requirements: rows, cuts: [] })).toBe(5);
});
it('drops the stored cut length from the form', () => {
  // A saved draft or generated plan carries a derived length; the form
  // neither shows nor resubmits it.
  const stored = {
    workOrderId,
    requirements: [],
    plan: { cuts: [{ stockItemId: null, lengthMm: 2743.2, items: [] }] },
  };
  expect(allocationToForm(stored, units)).toEqual({
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
  // A blind's API field names map to the form's.
  expect(name('requirements.1.widthMm')).toBe('requirements.1.width');
  expect(name('data.requirements.1.lengthMm')).toBe('requirements.1.length');
  expect(name('requirements.0.fabricColorId')).toBe(
    'requirements.0.fabricColorId',
  );
  expect(name(`context.requirements.${r.id}`)).toBe('requirements.1.quantity');
  expect(name(`context.stockItems.${stockItemId}`)).toBe('cuts.1.stockItemId');
  expect(name('plan.cuts.0')).toBe('cuts.0.stockItemId');
  expect(name('plan.cuts.1.lengthMm')).toBe('cuts.1.stockItemId');
  expect(name('plan.cuts.1.items.0')).toBe('cuts.1.items.0.requirementId');
  expect(name('plan.cuts.1.items.0.quantity')).toBe('cuts.1.items.0.quantity');
  // Issues about the whole list, such as a count that does not match the
  // order, or unknown records stay in the notice.
  expect(name('requirements')).toBeNull();
  expect(name(`context.requirements.${crypto.randomUUID()}`)).toBeNull();
});
