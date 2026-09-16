import type {
  LengthUnit,
  MeasurementField,
  MeasurementUnits,
} from '@roller-bay/shared/users';

// Integer factors keep unit → millimetre products exact before rounding.
const micrometresPerUnit: Record<LengthUnit, number> = {
  mm: 1_000,
  cm: 10_000,
  m: 1_000_000,
  in: 25_400,
  ft: 304_800,
  yd: 914_400,
};

export const unitNames: Record<LengthUnit, string> = {
  in: 'Inches',
  ft: 'Feet',
  yd: 'Yards',
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
};

// The API and database hold millimetres with three decimals; converted input
// is rounded back onto that grid so nothing finer is ever sent.
export const toMm = (value: number, unit: LengthUnit) =>
  Math.round(value * micrometresPerUnit[unit]) / 1000;

export const fromMm = (mm: number, unit: LengthUnit) =>
  mm / (micrometresPerUnit[unit] / 1000);

export const measurementLabel = (mm: number, unit: LengthUnit) =>
  `${Number(fromMm(mm, unit).toFixed(3))} ${unit}`;

// Editable values keep more precision than labels so an unchanged field
// round-trips to the same stored millimetre value in every offered unit.
export const measurementInput = (mm: number | null, unit: LengthUnit) =>
  mm === null ? '' : String(Number(fromMm(mm, unit).toFixed(6)));

export const measurementValue = (text: string, unit: LengthUnit) =>
  text.trim() === '' ? null : toMm(Number(text), unit);

export const fieldSuffix = (units: MeasurementUnits, field: MeasurementField) =>
  units[field];

export const fieldLabel = (
  units: MeasurementUnits,
  field: MeasurementField,
  mm: number,
) => measurementLabel(mm, units[field]);

export const fieldInput = (
  units: MeasurementUnits,
  field: MeasurementField,
  mm: number | null,
) => measurementInput(mm, units[field]);

export const fieldValue = (
  units: MeasurementUnits,
  field: MeasurementField,
  text: string,
) => measurementValue(text, units[field]);
