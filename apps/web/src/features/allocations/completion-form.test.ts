import { expect, it } from 'vitest';
import {
  defaultMeasurementUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import { allocation, ids, stock } from '../../../tests/fixtures';
import {
  completionFieldName,
  completionItemToForm,
  completionFromForm,
  completionToForm,
  completionRecovery,
} from './completion-form';
const units = defaultMeasurementUnits;

it('keeps roll measurements in mm and converts retained scraps from inches and yards', () => {
  const form = completionToForm(allocation, units);
  Object.assign(form.items[0]!, {
    outcome: 'returned-roll',
    tube: '50',
    depth: '12.5',
    scraps: [
      { width: '30', length: '2', quantity: '3', locationId: ids.location },
    ],
  });
  const result = completionFromForm(form, 1, units);
  expect(result.items[0]).toEqual({
    stockItemId: ids.stock,
    expectedRevision: 1,
    outcome: 'returned-roll',
    tubeOuterDiameterMm: 50,
    radialDepthMm: 12.5,
    locationId: ids.location,
    scraps: [
      { widthMm: 762, lengthMm: 1828.8, quantity: 3, locationId: ids.location },
    ],
  });
  expect(completionRecovery(result, allocation, units)).toEqual(form);
});

it('records returned remnants with explicit length and rejects an unfinished outcome or scrap quantity', () => {
  const form = completionToForm(allocation, units);
  expect(() => completionFromForm(form, 1, units)).toThrow();
  Object.assign(form.items[0]!, {
    outcome: 'returned-remnant',
    width: '24',
    length: '1.25',
  });
  expect(completionFromForm(form, 1, units).items[0]).toMatchObject({
    outcome: 'returned-remnant',
    widthMm: 609.6,
    explicitLengthMm: 1143,
  });
  expect(completionFromForm(form, 1, units).items[0]).not.toHaveProperty(
    'tubeOuterDiameterMm',
  );
  form.items[0]!.scraps = [
    { width: '12', length: '1', quantity: '', locationId: ids.location },
  ];
  expect(() => completionFromForm(form, 1, units)).toThrow();
});

it('follows the chosen units for tubes, depth, remnants, and scraps', () => {
  const metric: MeasurementUnits = {
    ...defaultMeasurementUnits,
    radialDepth: 'cm',
    tubeDiameter: 'in',
    rollWidth: 'mm',
    rollLength: 'm',
  };
  const form = completionToForm(allocation, metric);
  expect(form.items[0]!.width).toBe('2997.2');
  Object.assign(form.items[0]!, {
    outcome: 'returned-roll',
    tube: '2',
    depth: '1.25',
    scraps: [
      {
        width: '762',
        length: '1.8288',
        quantity: '1',
        locationId: ids.location,
      },
    ],
  });
  const result = completionFromForm(form, 1, metric);
  expect(result.items[0]).toMatchObject({
    tubeOuterDiameterMm: 50.8,
    radialDepthMm: 12.5,
    scraps: [{ widthMm: 762, lengthMm: 1828.8, quantity: 1 }],
  });
  expect(completionRecovery(result, allocation, metric)).toEqual(form);
});

it('places completion issues on the field that fixes them', () => {
  expect(completionFieldName('items.0.outcome')).toBe('items.0.outcome');
  expect(completionFieldName('items.1.radialDepthMm')).toBe('items.1.depth');
  expect(completionFieldName('items.0.tubeOuterDiameterMm')).toBe(
    'items.0.tube',
  );
  expect(completionFieldName('items.0.explicitLengthMm')).toBe(
    'items.0.length',
  );
  expect(completionFieldName('items.0.scraps.2.lengthMm')).toBe(
    'items.0.scraps.2.length',
  );
  expect(completionFieldName('items.0.scraps.2.locationId')).toBe(
    'items.0.scraps.2.locationId',
  );
  // Issues about the whole submission stay in the notice.
  expect(completionFieldName('items')).toBeNull();
  expect(completionFieldName('items.0')).toBeNull();
});

it('records a last-minute roll substitution and recovers the exact submission', () => {
  const form = completionToForm(allocation, units);
  Object.assign(form.items[0]!, {
    outcome: 'unused',
    depth: 'old incomplete input',
  });
  form.items.push({
    ...completionItemToForm({ ...stock, id: ids.receipt, revision: 7 }, units),
    outcome: 'consumed',
    tube: '50',
  });
  const body = completionFromForm(form, allocation.revision, units);
  expect(body.unusedStockItemIds).toEqual([ids.stock]);
  expect(body.items).toEqual([
    {
      stockItemId: ids.receipt,
      expectedRevision: 7,
      outcome: 'consumed',
      tubeOuterDiameterMm: 50,
      scraps: [],
    },
  ]);
  expect(
    completionFromForm(
      completionRecovery(body, allocation, units),
      allocation.revision,
      units,
    ),
  ).toEqual(body);
  expect(completionFieldName('items.0.tubeOuterDiameterMm', form)).toBe(
    'items.1.tube',
  );
});

it('requires actual usage and refuses duplicate or used-and-unused stock IDs', () => {
  const form = completionToForm(allocation, units);
  form.items[0]!.outcome = 'unused';
  expect(() => completionFromForm(form, 1, units)).toThrow();
  form.items.push({ ...form.items[0]!, outcome: 'consumed', tube: '50' });
  expect(() => completionFromForm(form, 1, units)).toThrow();
});
