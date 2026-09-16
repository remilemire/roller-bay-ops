export const count = (value: number) =>
  new Intl.NumberFormat('en-CA').format(value);
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
export function nullableNumber(value: string) {
  return value.trim() === '' ? null : Number(value);
}
export function nullableText(value: string) {
  return value.trim() || null;
}
export const mmToInches = (mm: number) => mm / 25.4;
export const mmToYards = (mm: number) => mm / 914.4;
export const inchesToMm = (inches: number) => Math.round(inches * 25400) / 1000;
export const yardsToMm = (yards: number) => Math.round(yards * 914400) / 1000;
export const dimension = (mm: number) =>
  `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 }).format(mm)} mm`;
export const widthLabel = (mm: number) =>
  `${Number(mmToInches(mm).toFixed(3))} in`;
export const lengthLabel = (mm: number) =>
  `${Number(mmToYards(mm).toFixed(3))} yd`;
export const widthInput = (mm: number | null) =>
  mm === null ? '' : String(Number(mmToInches(mm).toFixed(6)));
export const lengthInput = (mm: number | null) =>
  mm === null ? '' : String(Number(mmToYards(mm).toFixed(6)));
export const widthValue = (text: string) =>
  text.trim() === '' ? null : inchesToMm(Number(text));
export const lengthValue = (text: string) =>
  text.trim() === '' ? null : yardsToMm(Number(text));
