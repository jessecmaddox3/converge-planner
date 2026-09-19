export type LocalDate = string;

export interface ScanRange {
  startDate: LocalDate;
  endDate: LocalDate;
  timeZone: string;
}

export interface ValidatedScanRange extends ScanRange {
  inclusiveDays: number;
}

export type EventInterval =
  | {
      kind: "timed";
      start: string;
      end: string;
    }
  | {
      kind: "all-day";
      startDate: LocalDate;
      endDateExclusive: LocalDate;
    };

export interface CalendarSource {
  calendarId: string;
  name: string;
  color?: string | null;
  primary?: boolean;
}

export type ConflictSeverity = "none" | "low" | "moderate" | "high";

export interface BlockingDecision {
  countsAsConflict: boolean;
  severity: ConflictSeverity;
  moveable: boolean;
  reason: string;
}

export interface CalendarEvent {
  key: string;
  providerEventId: string;
  iCalUID: string | null;
  recurringEventId: string | null;
  originalStart: string | null;
  title: string;
  description: string;
  location: string;
  interval: EventInterval;
  occupiedDates: LocalDate[];
  durationMinutes: number | null;
  durationDays: number | null;
  eventType: string;
  status: string;
  transparency: string;
  selfResponse: string | null;
  attendeeCount: number;
  blocking: BlockingDecision;
  sources: CalendarSource[];
  updated: string | null;
}

export type CoverageStatus = "complete" | "partial" | "failed";

export interface FailedCalendar {
  calendarId: string;
  name?: string;
  reason: "auth" | "forbidden" | "rate_limited" | "timeout" | "upstream";
}

export interface ScanCoverage {
  status: CoverageStatus;
  requestedCalendarIds: string[];
  successfulCalendarIds: string[];
  failedCalendars: FailedCalendar[];
  truncated: boolean;
}
