import { expect, it } from 'vitest';
import { allocation, ids, timestamp } from '../../../tests/fixtures';
import {
  completionFromForm,
  completionToForm,
  completionRecovery,
} from './completion-form';

it('keeps roll measurements in mm and converts retained scraps from inches and yards', () => {
  const form = completionToForm(allocation);
  Object.assign(form.items[0]!, {
    outcome: 'returned-roll',
    tube: '50',
    depth: '12.5',
    scraps: [
      { width: '30', length: '2', quantity: '3', locationId: ids.location },
    ],
  });
  const result = completionFromForm(form, 1);
  expect(result.items[0]).toEqual({
    stockItemId: ids.stock,
    expectedUpdatedAt: timestamp,
    outcome: 'returned-roll',
    tubeOuterDiameterMm: 50,
    radialDepthMm: 12.5,
    locationId: ids.location,
    scraps: [
      { widthMm: 762, lengthMm: 1828.8, quantity: 3, locationId: ids.location },
    ],
  });
  expect(completionRecovery(result, allocation)).toEqual(form);
});

it('records returned remnants with explicit length and rejects an unfinished outcome or scrap quantity', () => {
  const form = completionToForm(allocation);
  expect(() => completionFromForm(form, 1)).toThrow();
  Object.assign(form.items[0]!, {
    outcome: 'returned-remnant',
    width: '24',
    length: '1.25',
  });
  expect(completionFromForm(form, 1).items[0]).toMatchObject({
    outcome: 'returned-remnant',
    widthMm: 609.6,
    explicitLengthMm: 1143,
  });
  expect(completionFromForm(form, 1).items[0]).not.toHaveProperty(
    'tubeOuterDiameterMm',
  );
  form.items[0]!.scraps = [
    { width: '12', length: '1', quantity: '', locationId: ids.location },
  ];
  expect(() => completionFromForm(form, 1)).toThrow();
});
