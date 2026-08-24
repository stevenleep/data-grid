import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const timeZoneValidity = new Map<string, boolean>();

export function resolveIntlLocale(locale: string | undefined): string {
  const fallback = locale?.toLocaleLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
  if (!locale) return fallback;
  try {
    return Intl.getCanonicalLocales(locale)[0] || fallback;
  } catch {
    return fallback;
  }
}

export function resolveGridTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC';
  const cached = timeZoneValidity.get(timeZone);
  if (cached !== undefined) return cached ? timeZone : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    timeZoneValidity.set(timeZone, true);
    return timeZone;
  } catch {
    timeZoneValidity.set(timeZone, false);
    return 'UTC';
  }
}

function formatterKey(locale: string, options: object): string {
  return `${locale}:${JSON.stringify(options)}`;
}

export function getNumberFormatter(
  locale: string | undefined,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const resolvedLocale = resolveIntlLocale(locale);
  const key = formatterKey(resolvedLocale, options);
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(resolvedLocale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

export function getDateTimeFormatter(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolvedLocale = resolveIntlLocale(locale);
  const safeOptions = {
    ...options,
    ...(options.timeZone ? { timeZone: resolveGridTimeZone(options.timeZone) } : {}),
  };
  const key = formatterKey(resolvedLocale, safeOptions);
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(resolvedLocale, safeOptions);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

function safePrimitiveText(value: unknown): string | undefined {
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

/** Parses supported date values without depending on the host's local time zone. */
export function parseGridDate(value: unknown, withTime: boolean): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? undefined : new Date(value.valueOf());
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? undefined : date;
  }
  const text = safePrimitiveText(value)?.trim();
  if (!text) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const offsetlessDateTime =
    withTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text);
  const date = new Date(
    dateOnly ? `${text}T00:00:00.000Z` : offsetlessDateTime ? `${text}Z` : text,
  );
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function gridDayjsValue(
  value: unknown,
  withTime: boolean,
  timeZone: string | undefined,
): Dayjs | null {
  if (!withTime && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = dayjs(value, 'YYYY-MM-DD');
    return parsed.isValid() ? parsed : null;
  }
  const parsed = parseGridDate(value, withTime);
  if (!parsed) return null;
  return dayjs(parsed).tz(resolveGridTimeZone(timeZone));
}
