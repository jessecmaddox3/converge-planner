import { occupiedDates } from "@/lib/calendar/range";
import type {
  BlockingDecision,
  CalendarEvent,
  CalendarSource,
  EventInterval,
  ScanRange,
} from "@/lib/calendar/types";

export interface GoogleEventDate {
  date?: string | null;
  dateTime?: string | null;
}

export interface GoogleEventAttendee {
  self?: boolean | null;
  resource?: boolean | null;
  responseStatus?: string | null;
}

export interface GoogleEventResource {
  id?: string | null;
  iCalUID?: string | null;
  recurringEventId?: string | null;
  originalStartTime?: GoogleEventDate | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: GoogleEventDate | null;
  end?: GoogleEventDate | null;
  eventType?: string | null;
  status?: string | null;
  transparency?: string | null;
  attendees?: GoogleEventAttendee[] | null;
  updated?: string | null;
}

export interface BlockingInput {
  eventType: string;
  status: string;
  transparency: string;
  selfResponse: string | null;
}

export interface DedupeResult {
  events: CalendarEvent[];
  duplicateCount: number;
}

export function blockingDecision(event: BlockingInput): BlockingDecision {
  if (event.status === "cancelled") {
    return {
      countsAsConflict: false,
      severity: "none",
      moveable: true,
      reason: "cancelled",
    };
  }
  if (event.transparency === "transparent") {
    return {
      countsAsConflict: false,
      severity: "none",
      moveable: true,
      reason: "transparent",
    };
  }
  if (event.selfResponse === "declined") {
    return {
      countsAsConflict: false,
      severity: "none",
      moveable: true,
      reason: "declined",
    };
  }
  if (event.eventType === "birthday") {
    return {
      countsAsConflict: false,
      severity: "none",
      moveable: true,
      reason: "birthday",
    };
  }
  if (event.eventType === "workingLocation") {
    return {
      countsAsConflict: false,
      severity: "none",
      moveable: true,
      reason: "working_location",
    };
  }
  if (event.eventType === "focusTime") {
    return {
      countsAsConflict: true,
      severity: "moderate",
      moveable: true,
      reason: "focus_time",
    };
  }
  if (event.eventType === "outOfOffice") {
    return {
      countsAsConflict: true,
      severity: "high",
      moveable: false,
      reason: "out_of_office",
    };
  }
  return {
    countsAsConflict: true,
    severity: "moderate",
    moveable: true,
    reason: event.eventType === "fromGmail" ? "gmail_event" : "opaque_event",
  };
}

function intervalFor(resource: GoogleEventResource): EventInterval | null {
  const start = resource.start;
  const end = resource.end;
  if (start?.date && end?.date) {
    return {
      kind: "all-day",
      startDate: start.date,
      endDateExclusive: end.date,
    };
  }
  if (start?.dateTime && end?.dateTime) {
    return {
      kind: "timed",
      start: start.dateTime,
      end: end.dateTime,
    };
  }
  return null;
}

function originalStartFor(resource: GoogleEventResource): string | null {
  return resource.originalStartTime?.dateTime || resource.originalStartTime?.date || null;
}

function eventKey(
  resource: GoogleEventResource,
  source: CalendarSource,
  interval: EventInterval
): string {
  const providerEventId = resource.id || "missing";
  const originalStart = originalStartFor(resource);
  const isRecurring = Boolean(resource.recurringEventId || originalStart);
  if (resource.iCalUID) {
    if (isRecurring) {
      const instanceStart =
        originalStart ||
        (interval.kind === "timed" ? interval.start : interval.startDate);
      return `${resource.iCalUID}|${instanceStart}`;
    }
    return resource.iCalUID;
  }
  return `${source.calendarId}|${providerEventId}`;
}

function allDayDuration(interval: Extract<EventInterval, { kind: "all-day" }>): number {
  return Math.round(
    (new Date(interval.endDateExclusive + "T12:00:00Z").getTime() -
      new Date(interval.startDate + "T12:00:00Z").getTime()) /
      86_400_000
  );
}

export function normalizeGoogleEvent(
  resource: GoogleEventResource,
  source: CalendarSource,
  range: ScanRange
): CalendarEvent | null {
  if (resource.status === "cancelled") return null;
  const providerEventId = resource.id;
  const interval = intervalFor(resource);
  if (!providerEventId || !interval) return null;

  let dates: string[];
  try {
    dates = occupiedDates(interval, range);
  } catch {
    return null;
  }
  if (dates.length === 0) return null;

  const selfResponse =
    resource.attendees?.find((attendee) => attendee.self)?.responseStatus || null;
  const eventType = resource.eventType || "default";
  const status = resource.status || "confirmed";
  const transparency = resource.transparency || "opaque";
  const timedDuration =
    interval.kind === "timed"
      ? Math.round(
          (new Date(interval.end).getTime() - new Date(interval.start).getTime()) / 60_000
        )
      : null;

  return {
    key: eventKey(resource, source, interval),
    providerEventId,
    iCalUID: resource.iCalUID || null,
    recurringEventId: resource.recurringEventId || null,
    originalStart: originalStartFor(resource),
    title: resource.summary || "Untitled",
    description: resource.description || "",
    location: resource.location || "",
    interval,
    occupiedDates: dates,
    durationMinutes: timedDuration,
    durationDays: interval.kind === "all-day" ? allDayDuration(interval) : null,
    eventType,
    status,
    transparency,
    selfResponse,
    attendeeCount: (resource.attendees || []).filter((attendee) => !attendee.resource).length,
    blocking: blockingDecision({ eventType, status, transparency, selfResponse }),
    sources: [{ ...source }],
    updated: resource.updated || null,
  };
}

function updatedTime(event: CalendarEvent): number {
  if (!event.updated) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(event.updated).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function preferredCopy(left: CalendarEvent, right: CalendarEvent): CalendarEvent {
  const leftUpdated = updatedTime(left);
  const rightUpdated = updatedTime(right);
  if (leftUpdated !== rightUpdated) return leftUpdated > rightUpdated ? left : right;

  const leftPrimary = Boolean(left.sources[0]?.primary);
  const rightPrimary = Boolean(right.sources[0]?.primary);
  if (leftPrimary !== rightPrimary) return leftPrimary ? left : right;

  const leftId = left.sources[0]?.calendarId || "";
  const rightId = right.sources[0]?.calendarId || "";
  return leftId.localeCompare(rightId) <= 0 ? left : right;
}

function mergeSources(events: CalendarEvent[]): CalendarSource[] {
  const byCalendar = new Map<string, CalendarSource>();
  for (const event of events) {
    for (const source of event.sources) {
      if (!byCalendar.has(source.calendarId)) byCalendar.set(source.calendarId, source);
    }
  }
  return Array.from(byCalendar.values()).sort((left, right) => {
    if (Boolean(left.primary) !== Boolean(right.primary)) return left.primary ? -1 : 1;
    return left.calendarId.localeCompare(right.calendarId);
  });
}

export function dedupeEvents(events: CalendarEvent[]): DedupeResult {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const group = groups.get(event.key);
    if (group) group.push(event);
    else groups.set(event.key, [event]);
  }

  const deduped = Array.from(groups.values()).map((copies) => {
    const winner = copies.reduce(preferredCopy);
    return { ...winner, sources: mergeSources(copies) };
  });

  return {
    events: deduped,
    duplicateCount: events.length - deduped.length,
  };
}
