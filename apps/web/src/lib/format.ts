export const count = (value: number) =>
  new Intl.NumberFormat('en-CA').format(value);
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
// For date-only values (YYYY-MM-DD). They parse as UTC midnight, so they are
// formatted in UTC; in the viewer's zone the day would slip west of Greenwich.
export const calendarDateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
export function nullableNumber(value: string) {
  return value.trim() === '' ? null : Number(value);
}
export function nullableText(value: string) {
  return value.trim() || null;
}
export const dimension = (mm: number) =>
  `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 }).format(mm)} mm`;
