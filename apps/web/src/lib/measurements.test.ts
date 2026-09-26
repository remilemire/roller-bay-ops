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
  inchParts,
  joinInches,
  measurementValue,
  parseAmount,
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

it('shows inches as fractions when the stored value is exact', () => {
  expect(measurementLabel(toMm(36.5, 'in'), 'in')).toBe('36 1/2 in');
  expect(measurementLabel(toMm(54 + 15 / 16, 'in'), 'in')).toBe('54 15/16 in');
  expect(measurementLabel(toMm(3 / 64, 'in'), 'in')).toBe('3/64 in');
  expect(measurementInput(toMm(72.125, 'in'), 'in')).toBe('72 1/8');
  // Not on a 1/64 inch mark, or not inches: decimals as before.
  expect(measurementLabel(1000, 'in')).toBe('39.37 in');
  expect(measurementInput(1000, 'in')).toBe('39.370079');
  expect(measurementLabel(toMm(2.5, 'yd'), 'yd')).toBe('2.5 yd');
});

it('reads decimals, mixed numbers and fraction glyphs', () => {
  for (const text of ['36.5', '36 1/2', '36-1/2', '36 - 1 / 2', '36½', '36 ½'])
    expect(parseAmount(text), text).toBe(36.5);
  expect(parseAmount('1/2')).toBe(0.5);
  expect(parseAmount('.25')).toBe(0.25);
  expect(parseAmount(' ')).toBeNull();
  for (const text of ['36 1/', '1/0', 'abc', '1e3', '36 1/2 3', '-4'])
    expect(parseAmount(text), text).toBeNaN();
  expect(measurementValue('36 1/2', 'in')).toBe(927.1);
});

it('splits inch amounts into a whole number and a proper fraction', () => {
  expect(inchParts('72 10/16')).toEqual({ whole: '72', fraction: '5/8' });
  expect(inchParts('72½')).toEqual({ whole: '72', fraction: '1/2' });
  expect(inchParts('3/4')).toEqual({ whole: '', fraction: '3/4' });
  for (const text of ['72.5', '72', '9/8', '72 5/', ''])
    expect(inchParts(text), text).toEqual({ whole: text, fraction: '' });
  expect(joinInches({ whole: '72', fraction: '5/8' })).toBe('72 5/8');
  expect(joinInches({ whole: '', fraction: '5/8' })).toBe('5/8');
  expect(joinInches({ whole: '72.5', fraction: '5/8' })).toBe('72.5');
});
