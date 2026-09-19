import { describe, expect, it } from "vitest";
import {
  blockingDecision,
  dedupeEvents,
  normalizeGoogleEvent,
} from "@/lib/calendar/normalize";
import type { CalendarSource, ScanRange } from "@/lib/calendar/types";

const range: ScanRange = {
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  timeZone: "America/New_York",
};

const primary: CalendarSource = {
  calendarId: "primary",
  name: "Primary",
  color: "#4285F4",
  primary: true,
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    iCalUID: "uid-1@example.com",
    summary: "Planning",
    status: "confirmed",
    transparency: "opaque",
    eventType: "default",
    updated: "2026-09-01T12:00:00.000Z",
    start: { dateTime: "2026-10-09T14:00:00-04:00" },
    end: { dateTime: "2026-10-09T15:00:00-04:00" },
    attendees: [
      { email: "self@example.com", self: true, responseStatus: "accepted" },
      { email: "room@example.com", resource: true, responseStatus: "accepted" },
      { email: "other@example.com", responseStatus: "accepted" },
    ],
    ...overrides,
  };
}

describe("normalizeGoogleEvent blocking policy", () => {
  it("normalizes a default opaque event and attendee signals", () => {
    const normalized = normalizeGoogleEvent(event(), primary, range);

    expect(normalized).toMatchObject({
      key: "uid-1@example.com",
      title: "Planning",
      occupiedDates: ["2026-10-09"],
      durationMinutes: 60,
      durationDays: null,
      selfResponse: "accepted",
      attendeeCount: 2,
      blocking: { countsAsConflict: true },
    });
  });

  it.each([
    ["transparent", event({ transparency: "transparent" }), "transparent"],
    [
      "self-declined",
      event({ attendees: [{ self: true, responseStatus: "declined" }] }),
      "declined",
    ],
    ["birthday", event({ eventType: "birthday" }), "birthday"],
    ["working location", event({ eventType: "workingLocation" }), "working_location"],
  ])("keeps %s events informational", (_label, resource, reason) => {
    const normalized = normalizeGoogleEvent(resource, primary, range);

    expect(normalized?.blocking).toMatchObject({
      countsAsConflict: false,
      severity: "none",
      reason,
    });
  });

  it("drops cancelled resources", () => {
    expect(
      normalizeGoogleEvent(event({ status: "cancelled" }), primary, range)
    ).toBeNull();
  });

  it.each([
    ["focusTime", "moderate", true],
    ["outOfOffice", "high", false],
  ])("classifies %s explicitly", (eventType, severity, moveable) => {
    const normalized = normalizeGoogleEvent(event({ eventType }), primary, range);

    expect(normalized?.blocking).toMatchObject({
      countsAsConflict: true,
      severity,
      moveable,
    });
  });

  it("keeps Gmail flights and tentative invitations as blockers", () => {
    const flight = normalizeGoogleEvent(
      event({ eventType: "fromGmail", summary: "Flight ATL to SFO" }),
      primary,
      range
    );
    const tentative = normalizeGoogleEvent(
      event({
        attendees: [{ self: true, responseStatus: "tentative" }],
      }),
      primary,
      range
    );

    expect(flight?.blocking.countsAsConflict).toBe(true);
    expect(tentative).toMatchObject({
      selfResponse: "tentative",
      blocking: { countsAsConflict: true },
    });
  });
});

describe("normalizeGoogleEvent identity and intervals", () => {
  it("projects all-day events with an exclusive end", () => {
    const normalized = normalizeGoogleEvent(
      event({
        start: { date: "2026-10-09" },
        end: { date: "2026-10-12" },
      }),
      primary,
      range
    );

    expect(normalized).toMatchObject({
      interval: {
        kind: "all-day",
        startDate: "2026-10-09",
        endDateExclusive: "2026-10-12",
      },
      occupiedDates: ["2026-10-09", "2026-10-10", "2026-10-11"],
      durationMinutes: null,
      durationDays: 3,
    });
  });

  it("keys recurring instances by UID and original start, including moved copies", () => {
    const first = normalizeGoogleEvent(
      event({
        id: "instance-1",
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-10-09T14:00:00-04:00" },
      }),
      primary,
      range
    );
    const second = normalizeGoogleEvent(
      event({
        id: "instance-2",
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-10-16T14:00:00-04:00" },
        start: { dateTime: "2026-10-17T14:00:00-04:00" },
        end: { dateTime: "2026-10-17T15:00:00-04:00" },
      }),
      primary,
      range
    );
    const movedCopy = normalizeGoogleEvent(
      event({
        id: "instance-copy",
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-10-16T14:00:00-04:00" },
        start: { dateTime: "2026-10-18T14:00:00-04:00" },
        end: { dateTime: "2026-10-18T15:00:00-04:00" },
      }),
      { calendarId: "shared", name: "Shared" },
      range
    );

    expect(first?.key).not.toBe(second?.key);
    expect(second?.key).toBe(movedCopy?.key);
    expect(second?.key).toContain("2026-10-16T14:00:00-04:00");
  });

  it("keeps missing-UID events calendar-qualified", () => {
    const normalized = normalizeGoogleEvent(
      event({ id: "provider-7", iCalUID: undefined }),
      { calendarId: "work", name: "Work" },
      range
    );

    expect(normalized?.key).toBe("work|provider-7");
  });
});

describe("dedupeEvents", () => {
  it("merges exact cross-calendar copies and chooses the newest resource", () => {
    const older = normalizeGoogleEvent(
      event({ summary: "Old copy", updated: "2026-09-01T12:00:00.000Z" }),
      primary,
      range
    )!;
    const newer = normalizeGoogleEvent(
      event({ summary: "New copy", updated: "2026-09-02T12:00:00.000Z" }),
      { calendarId: "shared", name: "Shared", color: "#00FF00" },
      range
    )!;

    const result = dedupeEvents([older, newer]);

    expect(result.duplicateCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("New copy");
    expect(result.events[0].sources.map((source) => source.calendarId)).toEqual([
      "primary",
      "shared",
    ]);
  });

  it("uses primary and then calendar ID as deterministic tie-breakers", () => {
    const shared = normalizeGoogleEvent(
      event({ summary: "Shared" }),
      { calendarId: "z-shared", name: "Shared" },
      range
    )!;
    const primaryCopy = normalizeGoogleEvent(
      event({ summary: "Primary" }),
      primary,
      range
    )!;
    const alpha = normalizeGoogleEvent(
      event({ summary: "Alpha", iCalUID: "uid-2@example.com" }),
      { calendarId: "a", name: "A" },
      range
    )!;
    const zeta = normalizeGoogleEvent(
      event({ summary: "Zeta", iCalUID: "uid-2@example.com" }),
      { calendarId: "z", name: "Z" },
      range
    )!;

    const result = dedupeEvents([shared, primaryCopy, zeta, alpha]);

    expect(result.events.find((item) => item.key === "uid-1@example.com")?.title).toBe("Primary");
    expect(result.events.find((item) => item.key === "uid-2@example.com")?.title).toBe("Alpha");
  });
});

describe("blockingDecision", () => {
  it("does not let needs-action opaque invitations look clear", () => {
    expect(
      blockingDecision({
        eventType: "default",
        status: "confirmed",
        transparency: "opaque",
        selfResponse: "needsAction",
      })
    ).toMatchObject({ countsAsConflict: true });
  });
});
