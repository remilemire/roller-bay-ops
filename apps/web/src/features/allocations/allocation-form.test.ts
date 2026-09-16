import { it, expect } from 'vitest';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  allocationFromForm,
  allocationToForm,
  emptyRequirement,
} from './allocation-form';
const units = defaultMeasurementUnits;
it('preserves requirement identity, assignment ordering, and incomplete cut settings', () => {
  const r = emptyRequirement();
  const data = allocationFromForm(
    {
      orderNumber: '',
      requirements: [
        { ...r, width: '22', length: '1.5', allowance: '0.5', quantity: '2' },
      ],
      settings: { edgeTrim: '1', remnantWidth: '', remnantLength: '' },
      drops: [
        {
          stockItemId: '',
          length: '',
          items: [{ requirementId: r.id, quantity: '' }],
        },
      ],
    },
    units,
  );
  expect(data.requirements[0]).toMatchObject({
    id: r.id,
    widthMm: 558.8,
    lengthMm: 1371.6,
    lengthAllowanceMm: 457.2,
    quantity: 2,
  });
  expect(data.plan.drops[0]).toMatchObject({
    stockItemId: null,
    lengthMm: null,
    items: [{ requirementId: r.id, quantity: null }],
  });
  expect(data.settings).toEqual({
    edgeTrimMm: 25.4,
    minimumRemnantWidthMm: null,
    minimumRemnantLengthMm: null,
  });
  expect(allocationFromForm(allocationToForm(data, units), units)).toEqual(
    data,
  );
});
it('rejects assignments whose requirement was removed', () => {
  expect(() =>
    allocationFromForm(
      {
        ...allocationToForm(undefined, units),
        drops: [
          {
            stockItemId: '',
            length: '',
            items: [{ requirementId: crypto.randomUUID(), quantity: '1' }],
          },
        ],
      },
      units,
    ),
  ).toThrow();
});
it('lets blind drops use inches while other fields keep their own units', () => {
  const r = emptyRequirement();
  const inchDrops: MeasurementUnits = {
    ...defaultMeasurementUnits,
    finishedDrop: 'in',
    dropAllowance: 'in',
    edgeTrim: 'mm',
    dropLength: 'm',
  };
  const data = allocationFromForm(
    {
      orderNumber: 'RB-1',
      requirements: [
        { ...r, width: '22', length: '72', allowance: '2', quantity: '1' },
      ],
      settings: { edgeTrim: '25.4', remnantWidth: '10', remnantLength: '' },
      drops: [{ stockItemId: '', length: '2.7432', items: [] }],
    },
    inchDrops,
  );
  expect(data.requirements[0]).toMatchObject({
    widthMm: 558.8,
    lengthMm: 1828.8,
    lengthAllowanceMm: 50.8,
  });
  expect(data.settings).toEqual({
    edgeTrimMm: 25.4,
    minimumRemnantWidthMm: 254,
    minimumRemnantLengthMm: null,
  });
  expect(data.plan.drops[0]!.lengthMm).toBe(2743.2);
  expect(allocationToForm(data, inchDrops).requirements[0]).toMatchObject({
    length: '72',
    allowance: '2',
  });
  expect(allocationToForm(data, units)).toMatchObject({
    requirements: [{ length: '2', allowance: '0.055556' }],
    settings: { edgeTrim: '1' },
    drops: [{ length: '3' }],
  });
});
