import { it, expect } from 'vitest';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  allocationFieldName,
  allocationFormSchema,
  allocationFromForm,
  allocationToForm,
  emptyRequirement,
} from './allocation-form';
const units = defaultMeasurementUnits;
it('preserves requirement identity, assignment ordering, and incomplete fields', () => {
  const r = emptyRequirement();
  const data = allocationFromForm(
    {
      orderNumber: '',
      requirements: [{ ...r, width: '22', length: '54', quantity: '2' }],
      cuts: [
        { stockItemId: '', items: [{ requirementId: r.id, quantity: '' }] },
      ],
    },
    units,
  );
  expect(data.requirements[0]).toMatchObject({
    id: r.id,
    widthMm: 558.8,
    lengthMm: 1371.6,
    quantity: 2,
  });
  expect(data.plan.cuts[0]).toEqual({
    stockItemId: null,
    items: [{ requirementId: r.id, quantity: null }],
  });
  expect(data).not.toHaveProperty('settings');
  expect(data.requirements[0]).not.toHaveProperty('lengthAllowanceMm');
  expect(allocationFromForm(allocationToForm(data, units), units)).toEqual(
    data,
  );
});
it('rejects assignments whose requirement was removed', () => {
  expect(() =>
    allocationFromForm(
      {
        ...allocationToForm(undefined, units),
        cuts: [
          {
            stockItemId: '',
            items: [{ requirementId: crypto.randomUUID(), quantity: '1' }],
          },
        ],
      },
      units,
    ),
  ).toThrow();
});
it('lets blind drops use their own unit and drops the stored cut length from the form', () => {
  const r = emptyRequirement();
  const inchDrops: MeasurementUnits = {
    ...defaultMeasurementUnits,
    finishedDrop: 'in',
    dropAllowance: 'in',
    edgeTrim: 'mm',
    cutLength: 'm',
  };
  const data = allocationFromForm(
    {
      orderNumber: '104801',
      requirements: [{ ...r, width: '22', length: '72', quantity: '1' }],
      cuts: [{ stockItemId: '', items: [] }],
    },
    inchDrops,
  );
  expect(data.requirements[0]).toMatchObject({
    widthMm: 558.8,
    lengthMm: 1828.8,
  });
  expect(data).not.toHaveProperty('settings');
  expect(data.requirements[0]).not.toHaveProperty('lengthAllowanceMm');
  expect(allocationToForm(data, inchDrops).requirements[0]).toMatchObject({
    length: '72',
  });
  // A saved draft or generated plan carries a derived length; the form
  // neither shows nor resubmits it.
  const stored = {
    ...data,
    plan: { cuts: [{ stockItemId: null, lengthMm: 2743.2, items: [] }] },
  };
  expect(allocationToForm(stored, units)).toEqual({
    orderNumber: '104801',
    requirements: [{ ...r, width: '22', length: '72', quantity: '1' }],
    cuts: [{ stockItemId: '', items: [] }],
  });
});
it('places API and plan-validator issues on the field that fixes them', () => {
  const r = emptyRequirement();
  const stockItemId = crypto.randomUUID();
  const form = {
    orderNumber: '',
    requirements: [emptyRequirement(), r],
    cuts: [
      { stockItemId: '', items: [] },
      { stockItemId, items: [{ requirementId: r.id, quantity: '1' }] },
    ],
  };
  const name = (path: string) => allocationFieldName(path, form);
  expect(name('orderNumber')).toBe('orderNumber');
  expect(name('data.requirements.1.widthMm')).toBe('requirements.1.width');
  expect(name(`context.requirements.${r.id}`)).toBe('requirements.1.quantity');
  expect(name(`context.stockItems.${stockItemId}`)).toBe('cuts.1.stockItemId');
  expect(name('plan.cuts.0')).toBe('cuts.0.stockItemId');
  expect(name('plan.cuts.1.lengthMm')).toBe('cuts.1.stockItemId');
  expect(name('plan.cuts.1.items.0')).toBe('cuts.1.items.0.requirementId');
  expect(name('plan.cuts.1.items.0.quantity')).toBe('cuts.1.items.0.quantity');
  // Issues about the whole list or unknown records stay in the notice.
  expect(name('requirements')).toBeNull();
  expect(name(`context.requirements.${crypto.randomUUID()}`)).toBeNull();
});
it('accepts a blank or six-digit order number only', () => {
  const parse = (orderNumber: string) =>
    allocationFormSchema.safeParse({ orderNumber, requirements: [], cuts: [] })
      .success;
  expect(parse('')).toBe(true);
  expect(parse('104802')).toBe(true);
  expect(parse('1048')).toBe(false);
  expect(parse('10480A')).toBe(false);
});
