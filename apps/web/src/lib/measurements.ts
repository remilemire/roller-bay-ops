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

// Inches read as fractions whenever the stored value is exactly a multiple of
// this step, so every cut to a tape-measure mark shows as one. Anything else,
// such as a width recorded in millimetres, keeps a decimal.
const inchDenominator = 64;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const inchFraction = (mm: number) => {
  const steps = Math.round(fromMm(mm, 'in') * inchDenominator);
  if (steps < 0 || toMm(steps / inchDenominator, 'in') !== mm) return null;
  const whole = Math.floor(steps / inchDenominator);
  const rest = steps % inchDenominator;
  if (rest === 0) return String(whole);
  const divisor = gcd(rest, inchDenominator);
  const fraction = `${rest / divisor}/${inchDenominator / divisor}`;
  return whole === 0 ? fraction : `${whole} ${fraction}`;
};

export const measurementAmount = (mm: number, unit: LengthUnit) =>
  (unit === 'in' && inchFraction(mm)) ||
  String(Number(fromMm(mm, unit).toFixed(3)));

export const measurementLabel = (mm: number, unit: LengthUnit) =>
  `${measurementAmount(mm, unit)} ${unit}`;

// Editable values keep more precision than labels so an unchanged field
// round-trips to the same stored millimetre value in every offered unit.
export const measurementInput = (mm: number | null, unit: LengthUnit) =>
  mm === null
    ? ''
    : (unit === 'in' && inchFraction(mm)) ||
      String(Number(fromMm(mm, unit).toFixed(6)));

const vulgarFractions: Record<string, string> = {
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};

// Accepts a decimal or a whole number and fraction: "36.5", "36 1/2",
// "36-1/2", "36½" and "1/2". Blank is null; anything else is NaN, which
// measurement inputs report as invalid before a form can submit it.
const normalizeFractions = (text: string) =>
  text
    .replace(/[½¼¾⅛⅜⅝⅞]/g, (glyph) => ` ${vulgarFractions[glyph]}`)
    .replace(/⁄/g, '/')
    .trim();

export const parseAmount = (text: string) => {
  const normalized = normalizeFractions(text);
  if (normalized === '') return null;
  if (/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return Number(normalized);
  const mixed = /^(?:(\d+)(?:\s+|\s*-\s*))?(\d+)\s*\/\s*(\d+)$/.exec(
    normalized,
  );
  if (!mixed || Number(mixed[3]) === 0) return NaN;
  return Number(mixed[1] ?? 0) + Number(mixed[2]) / Number(mixed[3]);
};

// An inch amount as the whole number and the proper fraction an inch input
// edits separately: "72 5/8" is 72 and 5/8. Decimals, improper fractions and
// unreadable text stay whole so nothing typed is reinterpreted.
export const inchParts = (text: string) => {
  const mixed = /^(?:(\d+)(?:\s+|\s*-\s*))?(\d+)\s*\/\s*(\d+)$/.exec(
    normalizeFractions(text),
  );
  const [top, bottom] = [Number(mixed?.[2]), Number(mixed?.[3])];
  if (!mixed || top === 0 || top >= bottom)
    return { whole: text, fraction: '' };
  const divisor = gcd(top, bottom);
  return {
    whole: mixed[1] ?? '',
    fraction: `${top / divisor}/${bottom / divisor}`,
  };
};

export const joinInches = ({
  whole,
  fraction,
}: {
  whole: string;
  fraction: string;
}) =>
  !fraction || whole.includes('.')
    ? whole
    : whole.trim() === ''
      ? fraction
      : `${whole.trim()} ${fraction}`;

export const measurementValue = (text: string, unit: LengthUnit) => {
  const amount = parseAmount(text);
  return amount === null ? null : toMm(amount, unit);
};

export const fieldSuffix = (units: MeasurementUnits, field: MeasurementField) =>
  units[field];

export const fieldLabel = (
  units: MeasurementUnits,
  field: MeasurementField,
  mm: number,
) => measurementLabel(mm, units[field]);

// A bare number for cells whose column heading already names the unit.
export const fieldAmount = (
  units: MeasurementUnits,
  field: MeasurementField,
  mm: number,
) => measurementAmount(mm, units[field]);

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
    "How far to unroll before one straight cut across the full fabric width. Calculated as the longest finished drop in the cut plus its drop allowance. Blinds sit side by side, so adding blinds doesn't lengthen the cut.",
  edgeTrim:
    "Width removed from each outside edge of the fabric before blinds are placed. Applied once per edge, not per blind. Applied automatically; it can't be changed on the order.",
  tubeDiameter:
    "The outside diameter of the cardboard tube the fabric is wound on, not its hollow centre. Record it after a roll's first cut; it stays the same for that roll.",
  radialDepth:
    'Distance from the tube surface to the outside of the fabric, measured on one side only: (roll diameter − tube diameter) ÷ 2. Used to calculate the remaining length.',
} satisfies Partial<Record<MeasurementField, string>>;

export const helpFor = (field: MeasurementField): string | undefined =>
  (measurementHelp as Partial<Record<MeasurementField, string>>)[field];
