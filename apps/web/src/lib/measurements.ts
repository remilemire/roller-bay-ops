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

// Tooltip explanations for measurements whose meaning is not obvious from the
// label. Configured amounts are omitted because they come from API settings.
export const measurementHelp = {
  finishedDrop:
    "The blind's final height once made. Enter it without any allowance; the drop allowance is added automatically.",
  dropAllowance:
    "Extra length added to each blind's finished drop, covering drop straightening, the bottom bar and tube attachment. Applied automatically; it can't be changed on the order.",
  cutLength:
    "How far to unroll before one straight cut across the full fabric width. Must equal the longest finished drop in the cut plus its drop allowance. Blinds sit side by side, so adding blinds doesn't lengthen the cut.",
  edgeTrim:
    "Width removed from each outside edge of the fabric before blinds are placed. Applied once per edge, not per blind. Applied automatically; it can't be changed on the order.",
  tubeDiameter:
    "The outside diameter of the cardboard tube the fabric is wound on, not its hollow centre. Record it after a roll's first cut; it stays the same for that roll.",
  radialDepth:
    'Distance from the tube surface to the outside of the fabric, measured on one side only: (roll diameter − tube diameter) ÷ 2. Used to calculate the remaining length.',
} satisfies Partial<Record<MeasurementField, string>>;

export const helpFor = (field: MeasurementField): string | undefined =>
  (measurementHelp as Partial<Record<MeasurementField, string>>)[field];
