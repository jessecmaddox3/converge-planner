import { GoogleCalendarFailure, listAllEvents } from "@/lib/calendar/google";
import { dedupeEvents, normalizeGoogleEvent } from "@/lib/calendar/normalize";
import {
  addCalendarDays,
  shiftHistoricalRange,
  validateScanRange,
} from "@/lib/calendar/range";
import type {
  CalendarEvent,
  CalendarSource,
  FailedCalendar,
  ScanCoverage,
  ScanRange,
} from "@/lib/calendar/types";

export const CALENDAR_REQUEST_TIMEOUT_MS = 15_000;
export const CALENDAR_SCAN_DEADLINE_MS = 45_000;
export const CALENDAR_SCAN_CONCURRENCY = 5;
export const MAX_TOTAL_EVENTS_PER_PERIOD = 10_000;
const MAX_HISTORY_SHIFT_ATTEMPTS = 10;

export interface CalendarMetadata {
  name: string;
  color?: string | null;
  primary?: boolean;
}

export interface CalendarScanRequest {
  calendarIds: string[];
  calendarMetadata?: Record<string, CalendarMetadata>;
  startDate: string;
  endDate: string;
  timeZone: string;
  historyPeriods?: 0 | 1 | 2;
}

export interface CalendarScanPeriod {
  range: Pick<ScanRange, "startDate" | "endDate">;
  events: CalendarEvent[];
  coverage: ScanCoverage;
}

export interface HistoricalScanPeriod extends CalendarScanPeriod {
  yearsBack: number;
}

export interface CalendarScanResponse {
  current: CalendarScanPeriod;
  history: HistoricalScanPeriod[];
  stats: {
    rawEvents: number;
    normalizedEvents: number;
    duplicateEvents: number;
    calendarRequests: number;
  };
}

interface PeriodResult extends CalendarScanPeriod {
  stats: CalendarScanResponse["stats"];
}

interface SuccessfulCalendar {
  calendarId: string;
  source: CalendarSource;
  items: Awaited<ReturnType<typeof listAllEvents>>["items"];
  truncated: boolean;
}

function validateCalendarIds(calendarIds: string[]): void {
  if (
    calendarIds.length < 1 ||
    calendarIds.length > 25 ||
    calendarIds.some(
      (id) => typeof id !== "string" || id.trim().length === 0,
    ) ||
    new Set(calendarIds).size !== calendarIds.length
  ) {
    throw new Error("INVALID_CALENDARS");
  }
}

function sourceFor(
  input: CalendarScanRequest,
  calendarId: string,
): CalendarSource {
  const metadata = input.calendarMetadata?.[calendarId];
  return {
    calendarId,
    name: metadata?.name || calendarId,
    color: metadata?.color || null,
    primary: Boolean(metadata?.primary),
  };
}

function providerRange(range: ScanRange) {
  return {
    timeMin: addCalendarDays(range.startDate, -1) + "T00:00:00.000Z",
    timeMax: addCalendarDays(range.endDate, 2) + "T00:00:00.000Z",
    timeZone: range.timeZone,
  };
}

function failureReason(error: unknown): FailedCalendar["reason"] {
  return error instanceof GoogleCalendarFailure ? error.kind : "upstream";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function fetchCalendarRange(
  accessToken: string,
  calendarId: string,
  range: ScanRange,
  source: CalendarSource,
  deadline: number,
): Promise<
  | { ok: true; value: SuccessfulCalendar }
  | { ok: false; failure: FailedCalendar; requested?: boolean }
> {
  const remaining = Math.min(
    CALENDAR_REQUEST_TIMEOUT_MS,
    deadline - Date.now(),
  );
  if (remaining <= 0)
    return {
      ok: false,
      requested: false,
      failure: { calendarId, name: source.name, reason: "timeout" },
    };
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new GoogleCalendarFailure("timeout"));
    }, remaining);
  });
  try {
    const result = await Promise.race([
      listAllEvents(
        accessToken,
        calendarId,
        providerRange(range),
        controller.signal,
      ),
      timedOut,
    ]);
    return {
      ok: true,
      value: {
        calendarId,
        source,
        items: result.items,
        truncated: result.truncated,
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        calendarId,
        name: source.name,
        reason: failureReason(error),
      },
    };
  } finally {
    clearTimeout(timeout!);
  }
}

async function scanPeriod(
  input: CalendarScanRequest,
  accessToken: string,
  range: ScanRange,
  deadline: number,
): Promise<PeriodResult> {
  const outcomes = await mapWithConcurrency(
    input.calendarIds,
    CALENDAR_SCAN_CONCURRENCY,
    (calendarId) =>
      fetchCalendarRange(
        accessToken,
        calendarId,
        range,
        sourceFor(input, calendarId),
        deadline,
      ),
  );

  const successes = outcomes
    .filter(
      (outcome): outcome is Extract<typeof outcome, { ok: true }> => outcome.ok,
    )
    .map((outcome) => outcome.value);
  const failedCalendars = outcomes
    .filter(
      (outcome): outcome is Extract<typeof outcome, { ok: false }> =>
        !outcome.ok,
    )
    .map((outcome) => outcome.failure);

  const rawEvents = successes.reduce(
    (total, success) => total + success.items.length,
    0,
  );
  const normalized = successes.flatMap((success) =>
    success.items
      .map((resource) => normalizeGoogleEvent(resource, success.source, range))
      .filter((event): event is CalendarEvent => event !== null),
  );
  const deduped = dedupeEvents(normalized);
  const totalCapReached = deduped.events.length > MAX_TOTAL_EVENTS_PER_PERIOD;
  const events = deduped.events.slice(0, MAX_TOTAL_EVENTS_PER_PERIOD);
  const successfulCalendarIds = successes.map((success) => success.calendarId);
  const status: ScanCoverage["status"] =
    successes.length === 0
      ? "failed"
      : failedCalendars.length > 0
        ? "partial"
        : "complete";

  return {
    range: { startDate: range.startDate, endDate: range.endDate },
    events,
    coverage: {
      status,
      requestedCalendarIds: [...input.calendarIds],
      successfulCalendarIds,
      failedCalendars,
      truncated:
        totalCapReached || successes.some((success) => success.truncated),
    },
    stats: {
      rawEvents,
      normalizedEvents: normalized.length,
      duplicateEvents: deduped.duplicateCount,
      calendarRequests: outcomes.filter(
        (outcome) => outcome.ok || outcome.requested !== false,
      ).length,
    },
  };
}

function localToday(timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addStats(
  target: CalendarScanResponse["stats"],
  addition: CalendarScanResponse["stats"],
): void {
  target.rawEvents += addition.rawEvents;
  target.normalizedEvents += addition.normalizedEvents;
  target.duplicateEvents += addition.duplicateEvents;
  target.calendarRequests += addition.calendarRequests;
}

export async function scanCalendars(
  input: CalendarScanRequest,
  accessToken: string,
): Promise<CalendarScanResponse> {
  validateCalendarIds(input.calendarIds);
  const currentRange = validateScanRange({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
  });
  const historyPeriods = input.historyPeriods ?? 0;
  if (![0, 1, 2].includes(historyPeriods))
    throw new Error("INVALID_HISTORY_PERIODS");

  const deadline = Date.now() + CALENDAR_SCAN_DEADLINE_MS;
  const current = await scanPeriod(input, accessToken, currentRange, deadline);
  const historical = await scanHistoryPeriods(
    input,
    accessToken,
    currentRange,
    deadline,
  );
  const stats = { ...current.stats };
  addStats(stats, historical.stats);
  return {
    current: {
      range: current.range,
      events: current.events,
      coverage: current.coverage,
    },
    history: historical.history,
    stats,
  };
}

async function scanHistoryPeriods(
  input: CalendarScanRequest,
  accessToken: string,
  currentRange: ScanRange,
  deadline: number,
) {
  const historyPeriods = input.historyPeriods ?? 0;
  const stats = {
    rawEvents: 0,
    normalizedEvents: 0,
    duplicateEvents: 0,
    calendarRequests: 0,
  };
  const history: HistoricalScanPeriod[] = [];
  const today = localToday(input.timeZone);

  for (
    let yearsBack = 1;
    history.length < historyPeriods && yearsBack <= MAX_HISTORY_SHIFT_ATTEMPTS;
    yearsBack += 1
  ) {
    const shifted = shiftHistoricalRange(currentRange, yearsBack, 4);
    // Padding helps match shifted weekends, but must not invalidate a legal
    // current range. Trim optional fuzz symmetrically to the provider limit.
    while (
      (Date.parse(shifted.endDate) - Date.parse(shifted.startDate)) / 86400000 +
        1 >
      366
    ) {
      shifted.startDate = addCalendarDays(shifted.startDate, 1);
      if (
        (Date.parse(shifted.endDate) - Date.parse(shifted.startDate)) /
          86400000 +
          1 >
        366
      )
        shifted.endDate = addCalendarDays(shifted.endDate, -1);
    }
    if (shifted.endDate >= today) continue;
    const historicalRange = validateScanRange({
      ...shifted,
      timeZone: input.timeZone,
    });
    const period = await scanPeriod(
      input,
      accessToken,
      historicalRange,
      deadline,
    );
    addStats(stats, period.stats);
    history.push({
      yearsBack,
      range: period.range,
      events: period.events,
      coverage: period.coverage,
    });
  }

  return { history, stats };
}

export async function scanCalendarHistory(
  input: CalendarScanRequest,
  accessToken: string,
): Promise<Pick<CalendarScanResponse, "history" | "stats">> {
  validateCalendarIds(input.calendarIds);
  const range = validateScanRange(input);
  if (![1, 2].includes(input.historyPeriods || 0))
    throw new Error("INVALID_HISTORY_PERIODS");
  return scanHistoryPeriods(
    input,
    accessToken,
    range,
    Date.now() + CALENDAR_SCAN_DEADLINE_MS,
  );
}
