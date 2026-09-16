import { expect, it } from 'vitest';
import {
  defaultMeasurementUnits,
  lengthUnits,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import {
  fieldInput,
  fieldLabel,
  fieldSuffix,
  fieldValue,
  fromMm,
  measurementInput,
  measurementLabel,
  measurementValue,
  toMm,
} from './measurements';

it('converts every offered unit onto the 0.001 mm grid', () => {
  expect(toMm(54, 'in')).toBe(1371.6);
  expect(toMm(3, 'ft')).toBe(914.4);
  expect(toMm(2.5, 'yd')).toBe(2286);
  expect(toMm(12.3456, 'mm')).toBe(12.346);
  expect(toMm(137.16, 'cm')).toBe(1371.6);
  expect(toMm(1.2345678, 'm')).toBe(1234.568);
  expect(fromMm(1371.6, 'in')).toBeCloseTo(54, 10);
  expect(fromMm(2286, 'yd')).toBeCloseTo(2.5, 10);
  expect(fromMm(2286, 'm')).toBeCloseTo(2.286, 10);
});

it('keeps blanks empty in both directions and labels to three decimals', () => {
  expect(measurementValue('', 'in')).toBeNull();
  expect(measurementValue('   ', 'm')).toBeNull();
  expect(measurementInput(null, 'yd')).toBe('');
  expect(measurementLabel(1371.6, 'in')).toBe('54 in');
  expect(measurementLabel(2286, 'yd')).toBe('2.5 yd');
  expect(measurementLabel(1371.6, 'mm')).toBe('1371.6 mm');
  expect(measurementLabel(1234.5678, 'cm')).toBe('123.457 cm');
  const thicknessInInches: MeasurementUnits = {
    ...defaultMeasurementUnits,
    thickness: 'in',
  };
  expect(fieldSuffix(defaultMeasurementUnits, 'rollLength')).toBe('yd');
  expect(fieldLabel(defaultMeasurementUnits, 'rollWidth', 1371.6)).toBe(
    '54 in',
  );
  expect(fieldInput(thicknessInInches, 'thickness', 0.357)).toBe('0.014055');
  expect(fieldValue(thicknessInInches, 'thickness', '0.014055')).toBe(0.357);
});

it('round-trips stored millimetre values through every unit', () => {
  for (const unit of lengthUnits)
    for (const mm of [0.001, 0.357, 1.234, 30000.125, 999999999.999])
      expect(
        measurementValue(measurementInput(mm, unit), unit),
        `${mm} mm via ${unit}`,
      ).toBe(mm);
});
