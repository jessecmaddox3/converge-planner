import type {
  EventInterval,
  LocalDate,
  ScanRange,
  ValidatedScanRange,
} from "@/lib/calendar/types";

export class CalendarRangeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CalendarRangeError";
  }
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseLocalDate(value: string): DateParts {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CalendarRangeError("INVALID_DATE", "Expected YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new CalendarRangeError("INVALID_DATE", "Date is not a real calendar date");
  }
  return { year, month, day };
}

function utcNoon(value: LocalDate): Date {
  const { year, month, day } = parseLocalDate(value);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatUtcDate(date: Date): LocalDate {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addCalendarDays(value: LocalDate, days: number): LocalDate {
  const date = utcNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function inclusiveDayCount(startDate: LocalDate, endDate: LocalDate): number {
  const elapsed = utcNoon(endDate).getTime() - utcNoon(startDate).getTime();
  return Math.round(elapsed / 86_400_000) + 1;
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new CalendarRangeError("INVALID_TIMEZONE", "Invalid IANA timezone");
  }
}

export function validateScanRange(input: ScanRange): ValidatedScanRange {
  parseLocalDate(input.startDate);
  parseLocalDate(input.endDate);
  validateTimeZone(input.timeZone);
  if (input.startDate > input.endDate) {
    throw new CalendarRangeError("RANGE_REVERSED", "Start date must not follow end date");
  }
  const inclusiveDays = inclusiveDayCount(input.startDate, input.endDate);
  if (inclusiveDays > 366) {
    throw new CalendarRangeError("RANGE_TOO_LARGE", "Calendar range exceeds 366 days");
  }
  return { ...input, inclusiveDays };
}

function localDateForInstant(instant: Date, timeZone: string): LocalDate {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function enumerateDates(startDate: LocalDate, endDate: LocalDate): LocalDate[] {
  if (startDate > endDate) return [];
  const dates: LocalDate[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

export function occupiedDates(interval: EventInterval, requestedRange: ScanRange): LocalDate[] {
  validateScanRange(requestedRange);

  let firstDate: LocalDate;
  let lastDate: LocalDate;
  if (interval.kind === "all-day") {
    parseLocalDate(interval.startDate);
    parseLocalDate(interval.endDateExclusive);
    if (interval.endDateExclusive <= interval.startDate) {
      throw new CalendarRangeError("INVALID_INTERVAL", "All-day end must follow start");
    }
    firstDate = interval.startDate;
    lastDate = addCalendarDays(interval.endDateExclusive, -1);
  } else {
    const start = new Date(interval.start);
    const end = new Date(interval.end);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end.getTime() <= start.getTime()
    ) {
      throw new CalendarRangeError("INVALID_INTERVAL", "Timed event interval is invalid");
    }
    firstDate = localDateForInstant(start, requestedRange.timeZone);
    lastDate = localDateForInstant(new Date(end.getTime() - 1), requestedRange.timeZone);
  }

  const clippedStart = firstDate < requestedRange.startDate
    ? requestedRange.startDate
    : firstDate;
  const clippedEnd = lastDate > requestedRange.endDate
    ? requestedRange.endDate
    : lastDate;
  return enumerateDates(clippedStart, clippedEnd);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function shiftDateBack(value: LocalDate, yearsBack: number): LocalDate {
  const { year, month, day } = parseLocalDate(value);
  const shiftedYear = year - yearsBack;
  const shiftedDay = Math.min(day, daysInMonth(shiftedYear, month));
  return `${String(shiftedYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(shiftedDay).padStart(2, "0")}`;
}

export function shiftHistoricalRange(
  range: Pick<ScanRange, "startDate" | "endDate">,
  yearsBack: number,
  bufferDays = 0
): Pick<ScanRange, "startDate" | "endDate"> {
  if (!Number.isInteger(yearsBack) || yearsBack < 1) {
    throw new CalendarRangeError("INVALID_HISTORY_SHIFT", "History shift must be positive");
  }
  if (!Number.isInteger(bufferDays) || bufferDays < 0) {
    throw new CalendarRangeError("INVALID_HISTORY_BUFFER", "History buffer must be nonnegative");
  }
  const startDate = shiftDateBack(range.startDate, yearsBack);
  const endDate = shiftDateBack(range.endDate, yearsBack);
  return {
    startDate: addCalendarDays(startDate, -bufferDays),
    endDate: addCalendarDays(endDate, bufferDays),
  };
}
