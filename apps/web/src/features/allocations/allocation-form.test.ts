import { it, expect } from 'vitest';
import {
  allocationFromForm,
  allocationToForm,
  emptyRequirement,
} from './allocation-form';
it('preserves requirement identity, assignment ordering, and incomplete cut settings', () => {
  const r = emptyRequirement();
  const data = allocationFromForm({
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
  });
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
  expect(allocationFromForm(allocationToForm(data))).toEqual(data);
});
it('rejects assignments whose requirement was removed', () => {
  expect(() =>
    allocationFromForm({
      ...allocationToForm(),
      drops: [
        {
          stockItemId: '',
          length: '',
          items: [{ requirementId: crypto.randomUUID(), quantity: '1' }],
        },
      ],
    }),
  ).toThrow();
});
