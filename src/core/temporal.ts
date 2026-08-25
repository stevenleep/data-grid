const dayMilliseconds = 86_400_000;
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/i;

const calendarFormatters = new Map<string, Intl.DateTimeFormat>();

export interface GridCalendarDateValue {
  year: number;
  month: number;
  day: number;
  serial: number;
  dayOfWeek: number;
}

function calendarFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = calendarFormatters.get(timeZone);
  if (formatter) return formatter;
  formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  calendarFormatters.set(timeZone, formatter);
  return formatter;
}

function utcTimestamp(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): number | undefined {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    millisecond < 0 ||
    millisecond > 999
  ) {
    return undefined;
  }
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, millisecond);
  date.setUTCFullYear(year, month - 1, day);
  const timestamp = date.valueOf();
  if (
    !Number.isFinite(timestamp) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return undefined;
  }
  return timestamp;
}

function calendarDate(year: number, month: number, day: number): GridCalendarDateValue | undefined {
  const timestamp = utcTimestamp(year, month, day);
  if (timestamp === undefined) return undefined;
  return {
    year,
    month,
    day,
    serial: Math.floor(timestamp / dayMilliseconds),
    dayOfWeek: new Date(timestamp).getUTCDay(),
  };
}

function dateFromObject(value: object): Date | undefined {
  try {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate !== 'function') return undefined;
    const date = toDate.call(value) as unknown;
    return date instanceof Date && Number.isFinite(date.valueOf()) ? date : undefined;
  } catch {
    return undefined;
  }
}

function isoDateTimeInstant(source: string): number | undefined {
  const match = dateTimePattern.exec(source);
  if (!match) return undefined;
  const fraction = (match[7] || '').padEnd(3, '0').slice(0, 3);
  const base = utcTimestamp(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
    Number(fraction || 0),
  );
  if (base === undefined) return undefined;

  const offset = match[8];
  if (!offset || offset.toUpperCase() === 'Z') return base;
  const sign = offset[0] === '+' ? 1 : -1;
  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) return undefined;
  const timestamp = base - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  return Number.isFinite(new Date(timestamp).valueOf()) ? timestamp : undefined;
}

/**
 * Converts a supported date-time representation to Unix milliseconds.
 * Numbers are milliseconds. Date-only and offsetless ISO strings are UTC;
 * ISO offsets are honored. Other string formats are deliberately rejected.
 */
export function gridDateTimeInstant(value: unknown): number | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.valueOf() : undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isFinite(new Date(value).valueOf()) ? value : undefined;
  }
  if (typeof value === 'string') {
    const source = value.trim();
    if (!source) return undefined;
    const dateOnly = dateOnlyPattern.exec(source);
    if (dateOnly) {
      return utcTimestamp(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    }
    return isoDateTimeInstant(source);
  }
  if (value && typeof value === 'object') {
    return dateFromObject(value)?.valueOf();
  }
  return undefined;
}

/**
 * Resolves a logical calendar date in an IANA timezone. `YYYY-MM-DD` is a
 * zone-free date; instant-like values are projected into the supplied zone.
 */
export function gridCalendarDate(
  value: unknown,
  timeZone = 'UTC',
): GridCalendarDateValue | undefined {
  if (typeof value === 'string') {
    const dateOnly = dateOnlyPattern.exec(value.trim());
    if (dateOnly) {
      return calendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    }
  }

  const timestamp = gridDateTimeInstant(value);
  if (timestamp === undefined) return undefined;
  const parts = calendarFormatter(timeZone).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return calendarDate(part('year'), part('month'), part('day'));
}

/** Throws when a timezone cannot be used for calendar-date semantics. */
export function assertGridCalendarTimeZone(timeZone: string): void {
  calendarFormatter(timeZone);
}

export function compareGridCalendarValues(
  left: unknown,
  right: unknown,
  timeZone = 'UTC',
): number | undefined {
  const normalizedLeft = gridCalendarDate(left, timeZone);
  const normalizedRight = gridCalendarDate(right, timeZone);
  if (!normalizedLeft || !normalizedRight) return undefined;
  return normalizedLeft.serial - normalizedRight.serial;
}

export function compareGridDateTimeInstants(left: unknown, right: unknown): number | undefined {
  const normalizedLeft = gridDateTimeInstant(left);
  const normalizedRight = gridDateTimeInstant(right);
  if (normalizedLeft === undefined || normalizedRight === undefined) return undefined;
  return normalizedLeft - normalizedRight;
}

function fallbackTemporalCompare(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  let leftText = '';
  let rightText = '';
  try {
    leftText = String(left ?? '');
  } catch {
    // Uncoercible invalid values sort as empty strings.
  }
  try {
    rightText = String(right ?? '');
  } catch {
    // Uncoercible invalid values sort as empty strings.
  }
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });
}

/** Default value-type equality for `date`, using zone-free/UTC calendar semantics. */
export function gridDateValueEquals(left: unknown, right: unknown): boolean {
  const compared = compareGridCalendarValues(left, right);
  return compared === undefined ? Object.is(left, right) : compared === 0;
}

/** Default value-type ordering for `date`, using zone-free/UTC calendar semantics. */
export function compareGridDateValues(left: unknown, right: unknown): number {
  return compareGridCalendarValues(left, right) ?? fallbackTemporalCompare(left, right);
}

/** Default value-type equality for `dateTime`, normalized to an absolute instant. */
export function gridDateTimeValueEquals(left: unknown, right: unknown): boolean {
  const compared = compareGridDateTimeInstants(left, right);
  return compared === undefined ? Object.is(left, right) : compared === 0;
}

/** Default value-type ordering for `dateTime`, normalized to an absolute instant. */
export function compareGridDateTimeValues(left: unknown, right: unknown): number {
  return compareGridDateTimeInstants(left, right) ?? fallbackTemporalCompare(left, right);
}
