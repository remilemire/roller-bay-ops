/**
 * Arithmetic on calendar days (`YYYY-MM-DD`) and months (`YYYY-MM`). A day is
 * handled as UTC midnight throughout, so no step depends on the viewer's
 * timezone or crosses a daylight-saving change.
 */
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The viewer's own calendar day, which is the one "today" means to them. */
export function today() {
  const now = new Date();
  return iso(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}
export function addDays(day: string, days: number) {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}
export function addMonths(month: string, months: number) {
  const date = utc(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return iso(date).slice(0, 7);
}
export const monthOf = (day: string) => day.slice(0, 7);
export const isWeekend = (day: string) => [0, 6].includes(utc(day).getUTCDay());
/** The Monday of the day's week; weeks run Monday to Sunday. */
export const mondayOf = (day: string) =>
  addDays(day, -((utc(day).getUTCDay() + 6) % 7));
/** The day itself, or the Monday after a weekend. */
export const nextWeekday = (day: string) =>
  isWeekend(day) ? addDays(mondayOf(day), 7) : day;
/** Monday to Friday of the week that starts on `monday`. */
export const workWeek = (monday: string) =>
  [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset));
/**
 * The weeks that cover a month, each Monday to Friday or Monday to Sunday.
 * Edge weeks include the neighbouring months' days, and a week whose shown
 * days all fall outside the month is left out.
 */
export function monthWeeks(month: string, weekdaysOnly: boolean) {
  const weeks: string[][] = [];
  for (
    let monday = mondayOf(`${month}-01`);
    monthOf(monday) <= month;
    monday = addDays(monday, 7)
  ) {
    const week = (weekdaysOnly ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6]).map(
      (offset) => addDays(monday, offset),
    );
    if (week.some((day) => monthOf(day) === month)) weeks.push(week);
  }
  return weeks;
}
export const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(utc(value).getTime());
export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
