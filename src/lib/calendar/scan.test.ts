import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => ({
  listAllEvents: vi.fn(),
}));

vi.mock("@/lib/calendar/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/google")>();
  return { ...actual, listAllEvents: adapter.listAllEvents };
});

import {
  CALENDAR_REQUEST_TIMEOUT_MS,
  scanCalendars,
} from "@/lib/calendar/scan";
import { GoogleCalendarFailure } from "@/lib/calendar/google";

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "provider-1",
    iCalUID: "uid-1@example.com",
    summary: "Planning",
    status: "confirmed",
    transparency: "opaque",
    eventType: "default",
    start: { dateTime: "2026-10-09T14:00:00-04:00" },
    end: { dateTime: "2026-10-09T15:00:00-04:00" },
    ...overrides,
  };
}

const input = {
  calendarIds: ["primary", "shared"],
  calendarMetadata: {
    primary: { name: "Primary", color: "#111111", primary: true },
    shared: { name: "Shared", color: "#222222" },
  },
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  timeZone: "America/New_York",
  historyPeriods: 0 as const,
};

describe("scanCalendars", () => {
  it("preserves a valid year-long current scan when historical fuzz exceeds the range limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const result = await scanCalendars(
      {
        ...input,
        startDate: "2026-10-02",
        endDate: "2027-10-01",
        historyPeriods: 2,
      },
      "token",
    );
    expect(result.current.coverage.status).toBe("complete");
    expect(result.history).toHaveLength(2);
  });
  beforeEach(() => {
    adapter.listAllEvents.mockReset();
    adapter.listAllEvents.mockResolvedValue({
      items: [rawEvent()],
      truncated: false,
      pageCount: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns complete deduplicated current coverage", async () => {
    const result = await scanCalendars(input, "token");

    expect(result.current.coverage).toEqual({
      status: "complete",
      requestedCalendarIds: ["primary", "shared"],
      successfulCalendarIds: ["primary", "shared"],
      failedCalendars: [],
      truncated: false,
    });
    expect(result.current.events).toHaveLength(1);
    expect(
      result.current.events[0].sources.map((source) => source.calendarId),
    ).toEqual(["primary", "shared"]);
    expect(result.stats.duplicateEvents).toBe(1);
  });

  it("reports one-calendar partial coverage without discarding successes", async () => {
    adapter.listAllEvents.mockImplementation(async (_token, calendarId) => {
      if (calendarId === "shared")
        throw new GoogleCalendarFailure("forbidden", 403);
      return { items: [rawEvent()], truncated: false, pageCount: 1 };
    });

    const result = await scanCalendars(input, "token");

    expect(result.current.coverage).toMatchObject({
      status: "partial",
      successfulCalendarIds: ["primary"],
      failedCalendars: [
        { calendarId: "shared", name: "Shared", reason: "forbidden" },
      ],
    });
    expect(result.current.events).toHaveLength(1);
  });

  it("returns structured failed coverage when all current calendars fail", async () => {
    adapter.listAllEvents.mockRejectedValue(
      new GoogleCalendarFailure("upstream", 502),
    );

    const result = await scanCalendars(input, "token");

    expect(result.current.events).toEqual([]);
    expect(result.current.coverage).toMatchObject({
      status: "failed",
      successfulCalendarIds: [],
    });
    expect(result.current.coverage.failedCalendars).toHaveLength(2);
  });

  it("keeps complete current results when history fails", async () => {
    adapter.listAllEvents.mockImplementation(
      async (_token, _calendarId, range) => {
        if (range.timeMin.startsWith("2025-")) {
          throw new GoogleCalendarFailure("upstream", 500);
        }
        return { items: [rawEvent()], truncated: false, pageCount: 1 };
      },
    );

    const result = await scanCalendars(
      { ...input, historyPeriods: 1 },
      "token",
    );

    expect(result.current.coverage.status).toBe("complete");
    expect(result.history).toHaveLength(1);
    expect(result.history[0].coverage.status).toBe("failed");
  });

  it("propagates adapter truncation into coverage", async () => {
    adapter.listAllEvents.mockResolvedValue({
      items: [rawEvent()],
      truncated: true,
      pageCount: 2,
    });

    const result = await scanCalendars(input, "token");

    expect(result.current.coverage).toMatchObject({
      status: "complete",
      truncated: true,
    });
  });

  it("limits calendar-range concurrency to five", async () => {
    let active = 0;
    let maximum = 0;
    adapter.listAllEvents.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { items: [], truncated: false, pageCount: 1 };
    });

    await scanCalendars(
      {
        ...input,
        calendarIds: Array.from(
          { length: 12 },
          (_, index) => `calendar-${index}`,
        ),
        calendarMetadata: undefined,
      },
      "token",
    );

    expect(maximum).toBe(5);
  });

  it("aborts a stalled calendar range and reports timeout coverage", async () => {
    vi.useFakeTimers();
    adapter.listAllEvents.mockImplementation(
      (_token, _calendarId, _range, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new GoogleCalendarFailure("timeout"));
          });
        }),
    );

    const pending = scanCalendars(
      { ...input, calendarIds: ["primary"] },
      "token",
    );
    await vi.advanceTimersByTimeAsync(CALENDAR_REQUEST_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.current.coverage.failedCalendars).toEqual([
      { calendarId: "primary", name: "Primary", reason: "timeout" },
    ]);
  });

  it("stops the whole 25-calendar scan at 45 seconds, retaining successful results", async () => {
    vi.useFakeTimers();
    adapter.listAllEvents.mockImplementation((_token, calendarId) =>
      calendarId === "calendar-0"
        ? Promise.resolve({
            items: [rawEvent()],
            truncated: false,
            pageCount: 1,
          })
        : new Promise(() => {}),
    );
    const pending = scanCalendars(
      {
        ...input,
        calendarIds: Array.from(
          { length: 25 },
          (_, index) => `calendar-${index}`,
        ),
        calendarMetadata: undefined,
      },
      "token",
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(45001);
    expect(settled).toBe(true);
    const result = await pending;
    expect(result.current.events).toHaveLength(1);
    expect(result.current.coverage.status).toBe("partial");
    expect(result.current.coverage.failedCalendars).toHaveLength(24);
    expect(adapter.listAllEvents.mock.calls.length).toBeLessThan(25);
  });

  it("uses a four-day historical buffer and clamps leap day", async () => {
    adapter.listAllEvents.mockResolvedValue({
      items: [],
      truncated: false,
      pageCount: 1,
    });

    const result = await scanCalendars(
      {
        ...input,
        calendarIds: ["primary"],
        startDate: "2024-02-29",
        endDate: "2024-03-02",
        historyPeriods: 1,
      },
      "token",
    );

    expect(result.history[0]).toMatchObject({
      yearsBack: 1,
      range: { startDate: "2023-02-24", endDate: "2023-03-06" },
    });
  });
});
