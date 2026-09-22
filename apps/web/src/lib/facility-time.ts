export const FACILITY_TIME_ZONE =
  process.env.NEXT_PUBLIC_FACILITY_TIME_ZONE ?? 'America/Edmonton';

const localDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const facilityParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: FACILITY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsAt(instant: number) {
  const values = Object.fromEntries(
    facilityParts
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year ?? Number.NaN,
    month: values.month ?? Number.NaN,
    day: values.day ?? Number.NaN,
    hour: values.hour ?? Number.NaN,
    minute: values.minute ?? Number.NaN,
    second: values.second ?? Number.NaN,
  };
}

/** Convert a datetime-local control value in the facility zone to an instant. */
export function facilityTimeToIso(value: string) {
  const match = localDateTime.exec(value);
  if (!match) throw new Error('Enter a valid completion date and time.');
  const wanted = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const wallClock = Date.UTC(
    wanted.year,
    wanted.month - 1,
    wanted.day,
    wanted.hour,
    wanted.minute,
    wanted.second,
  );
  let instant = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = partsAt(instant);
    const shownAsUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    instant = wallClock - (shownAsUtc - instant);
  }
  const shown = partsAt(instant);
  if (
    Object.keys(wanted).some(
      (key) =>
        shown[key as keyof typeof shown] !== wanted[key as keyof typeof wanted],
    )
  ) {
    throw new Error(
      `That local time does not exist in ${FACILITY_TIME_ZONE} because of a daylight-saving transition.`,
    );
  }
  return new Date(instant).toISOString();
}
