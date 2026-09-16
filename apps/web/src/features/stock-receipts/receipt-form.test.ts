import { it, expect } from 'vitest';
import {
  receiptFromForm,
  receiptToForm,
  emptyReceiptLine,
} from './receipt-form';
it('retains unfinished fields, quantities and IDs while converting inches and yards exactly', () => {
  const data = receiptFromForm({
    purchaseOrderNumber: '',
    items: [{ ...emptyReceiptLine(), width: '54', length: '2.5' }],
  });
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
  expect(receiptFromForm(receiptToForm(data))).toEqual(data);
});
it('round-trips measurements at millimetre precision and rejects invalid supplied numbers', () => {
  for (const length of [0.001, 1.234, 999999999.999, 30000.125]) {
    const data = receiptFromForm({
      purchaseOrderNumber: '',
      items: [
        { ...emptyReceiptLine(), width: '54', length: String(length / 914.4) },
      ],
    });
    expect(receiptFromForm(receiptToForm(data))).toEqual(data);
  }
  expect(() =>
    receiptFromForm({
      purchaseOrderNumber: '',
      items: [{ ...emptyReceiptLine(), width: '-1' }],
    }),
  ).toThrow();
});
