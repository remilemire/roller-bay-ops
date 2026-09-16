import { it, expect } from 'vitest';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  receiptFromForm,
  receiptToForm,
  emptyReceiptLine,
} from './receipt-form';
const units = defaultMeasurementUnits;
it('retains unfinished fields, quantities and IDs while converting inches and yards exactly', () => {
  const data = receiptFromForm(
    {
      purchaseOrderNumber: '',
      items: [{ ...emptyReceiptLine(), width: '54', length: '2.5' }],
    },
    units,
  );
  expect(data).toMatchObject({
    purchaseOrderNumber: null,
    items: [
      {
        widthMm: 1371.6,
        initialLengthMm: 2286,
        quantity: null,
        fabricColorId: null,
        locationId: null,
      },
    ],
  });
  expect(receiptFromForm(receiptToForm(data, units), units)).toEqual(data);
});
it('round-trips measurements at millimetre precision and rejects invalid supplied numbers', () => {
  for (const length of [0.001, 1.234, 999999999.999, 30000.125]) {
    const data = receiptFromForm(
      {
        purchaseOrderNumber: '',
        items: [
          {
            ...emptyReceiptLine(),
            width: '54',
            length: String(length / 914.4),
          },
        ],
      },
      units,
    );
    expect(receiptFromForm(receiptToForm(data, units), units)).toEqual(data);
  }
  expect(() =>
    receiptFromForm(
      {
        purchaseOrderNumber: '',
        items: [{ ...emptyReceiptLine(), width: '-1' }],
      },
      units,
    ),
  ).toThrow();
});
it('reads and writes each field in the unit chosen for it', () => {
  const metric: MeasurementUnits = {
    ...defaultMeasurementUnits,
    rollWidth: 'cm',
    rollLength: 'm',
  };
  const data = receiptFromForm(
    {
      purchaseOrderNumber: '',
      items: [{ ...emptyReceiptLine(), width: '137.16', length: '2.286' }],
    },
    metric,
  );
  expect(data.items[0]).toMatchObject({
    widthMm: 1371.6,
    initialLengthMm: 2286,
  });
  expect(receiptToForm(data, metric).items[0]).toMatchObject({
    width: '137.16',
    length: '2.286',
  });
  expect(receiptToForm(data, units).items[0]).toMatchObject({
    width: '54',
    length: '2.5',
  });
});
