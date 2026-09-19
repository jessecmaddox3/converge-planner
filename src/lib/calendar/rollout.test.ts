import { describe, expect, it } from "vitest";
import {
  enrichWindowsWithEvents,
  indexEventsByDate,
  scoreCalendarEvent,
} from "@/lib/analysis";
import {
  dedupeEvents,
  normalizeGoogleEvent,
} from "@/lib/calendar/normalize";
import type {
  CalendarSource,
  ScanCoverage,
  ScanRange,
} from "@/lib/calendar/types";

const primary: CalendarSource = {
  calendarId: "primary",
  name: "Primary",
  primary: true,
};

const octoberRange: ScanRange = {
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  timeZone: "America/New_York",
};

function googleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "provider-1",
    iCalUID: "uid-1@example.com",
    summary: "Planning",
    status: "confirmed",
    transparency: "opaque",
    eventType: "default",
    updated: "2026-09-01T12:00:00.000Z",
    start: { dateTime: "2026-10-09T14:00:00-04:00" },
    end: { dateTime: "2026-10-09T15:00:00-04:00" },
    ...overrides,
  };
}

describe("calendar v2 rollout fixtures", () => {
  it("keeps busy recurring instances distinct by original start", () => {
    const events = Array.from({ length: 8 }, (_, index) => {
      const day = String(2 + index * 3).padStart(2, "0");
      return normalizeGoogleEvent(
        googleEvent({
          id: `instance-${index}`,
          iCalUID: "busy-series@example.com",
          recurringEventId: "series-1",
          originalStartTime: {
            dateTime: `2026-10-${day}T09:00:00-04:00`,
          },
          start: { dateTime: `2026-10-${day}T09:00:00-04:00` },
          end: { dateTime: `2026-10-${day}T10:00:00-04:00` },
        }),
        primary,
        octoberRange
      )!;
    });

    const deduped = dedupeEvents(events);

    expect(deduped.events).toHaveLength(8);
    expect(new Set(deduped.events.map((event) => event.key)).size).toBe(8);
  });

  it("projects multi-day travel across every date and scores it once", () => {
    const travel = normalizeGoogleEvent(
      googleEvent({
        iCalUID: "travel@example.com",
        summary: "Flight and conference",
        start: { date: "2026-10-09" },
        end: { date: "2026-10-13" },
      }),
      primary,
      octoberRange
    )!;
    const scored = scoreCalendarEvent(travel);
    const indexed = indexEventsByDate([scored]);
    const [window] = enrichWindowsWithEvents(
      [{ start: "2026-10-09", end: "2026-10-12" }],
      [scored],
      []
    );

    expect(Object.keys(indexed)).toEqual([
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]);
    expect(window.eventCount).toBe(1);
    expect(window.conflict_score).toBe(scored.importance_score);
  });

  it("never labels an empty partial scan all clear", () => {
    const partialCoverage: ScanCoverage = {
      status: "partial",
      requestedCalendarIds: ["primary", "shared"],
      successfulCalendarIds: ["primary"],
      failedCalendars: [
        { calendarId: "shared", name: "Shared", reason: "forbidden" },
      ],
      truncated: false,
    };
    const [window] = enrichWindowsWithEvents(
      [{ start: "2026-10-09", end: "2026-10-11" }],
      [],
      [],
      partialCoverage
    );

    expect(window.aiSeverity).not.toBe("clear");
    expect(window.summary).toContain("coverage is incomplete");
  });

  it("merges exact shared-calendar copies without double scoring", () => {
    const first = normalizeGoogleEvent(
      googleEvent({ iCalUID: "shared-copy@example.com" }),
      primary,
      octoberRange
    )!;
    const second = normalizeGoogleEvent(
      googleEvent({
        id: "provider-shared",
        iCalUID: "shared-copy@example.com",
      }),
      { calendarId: "shared", name: "Shared" },
      octoberRange
    )!;

    const deduped = dedupeEvents([first, second]);
    const scored = deduped.events.map(scoreCalendarEvent);
    const [window] = enrichWindowsWithEvents(
      [{ start: "2026-10-09", end: "2026-10-09" }],
      scored,
      []
    );

    expect(deduped.events).toHaveLength(1);
    expect(deduped.events[0].sources).toHaveLength(2);
    expect(window.eventCount).toBe(1);
  });

  it("projects an overnight event across the spring-forward boundary", () => {
    const dstRange: ScanRange = {
      startDate: "2026-03-07",
      endDate: "2026-03-08",
      timeZone: "America/New_York",
    };
    const overnight = normalizeGoogleEvent(
      googleEvent({
        iCalUID: "dst-trip@example.com",
        start: { dateTime: "2026-03-08T04:30:00.000Z" },
        end: { dateTime: "2026-03-08T07:30:00.000Z" },
      }),
      primary,
      dstRange
    );

    expect(overnight).toMatchObject({
      occupiedDates: ["2026-03-07", "2026-03-08"],
      durationMinutes: 180,
    });
  });
});
