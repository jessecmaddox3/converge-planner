import { describe, it, expect } from "vitest";
import {
  formatLocalDate,
  scoreEvent,
  parseDurationMinutes,
  generateRecommendedWindows,
  generateWindowHistoricalInsight,
  enrichWindowsWithEvents,
  buildGroupVotes,
  validateClusters,
  buildHistClusters,
  groupEventsByCluster,
  findCandidateStart,
  indexEventsByDate,
  scoreCalendarEvent,
} from "@/lib/analysis";
import type { CalendarEvent, ScanCoverage } from "@/lib/calendar/types";
import type { AwaySpan } from "@/lib/calendar/away";

describe("formatLocalDate", () => {
  it("formats without UTC shift", () => {
    expect(formatLocalDate(new Date(2026, 9, 9))).toBe("2026-10-09");
    expect(formatLocalDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("generateRecommendedWindows", () => {
  it("prefers five movable commitments over a fixed wedding", () => {
    const windows = generateRecommendedWindows("2026-10-09", "2026-10-18", 3, "weekend", [
      { title: "Wedding", date: "2026-10-09", importance_score: 9, moveable: false },
      ...Array.from({ length: 5 }, (_, i) => ({ title: `Meeting ${i}`, date: "2026-10-16", importance_score: 2, moveable: true })),
    ], []);
    expect(windows[0].start).toBe("2026-10-16");
  });
  // Oct 2026: Fri Oct 9, Sat 10, Sun 11 ... Fri Oct 30
  const start = "2026-10-01";
  const end = "2026-10-31";

  it("weekend preset generates Fri–Sun windows (3 calendar days)", () => {
    const windows = generateRecommendedWindows(start, end, 3, "weekend", [], []);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      const s = new Date(w.start + "T12:00:00");
      const e = new Date(w.end + "T12:00:00");
      expect(s.getDay()).toBe(5); // Friday
      expect(e.getDay()).toBe(0); // Sunday
      expect((e.getTime() - s.getTime()) / 86400000).toBe(2); // start + 2 days
    }
  });

  it("weekend windows never extend past the range end", () => {
    // Range ends Sat Oct 31 — the Fri Oct 30 weekend would end Nov 1, excluded
    const windows = generateRecommendedWindows(start, end, 3, "weekend", [], []);
    for (const w of windows) expect(w.end <= end).toBe(true);
  });

  it("day preset generates one window per day", () => {
    const windows = generateRecommendedWindows("2026-10-01", "2026-10-05", 1, "day", [], []);
    expect(windows).toHaveLength(5);
    expect(windows.every((w) => w.start === w.end)).toBe(true);
  });

  it("custom one-day windows include every date in the range", () => {
    const windows = generateRecommendedWindows("2026-10-01", "2026-10-10", 1, "custom", [], []);
    expect(windows.map((window) => window.start)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
  });

  it("week preset generates Mon–Sun windows", () => {
    const windows = generateRecommendedWindows(start, end, 7, "week", [], []);
    for (const w of windows) {
      expect(new Date(w.start + "T12:00:00").getDay()).toBe(1);
      expect(new Date(w.end + "T12:00:00").getDay()).toBe(0);
    }
  });

  it("normalizes legacy two-day weekend input to Friday through Sunday", () => {
    const [window] = generateRecommendedWindows(
      "2026-10-09",
      "2026-10-11",
      2,
      "weekend",
      [],
      []
    );

    expect(window).toMatchObject({ start: "2026-10-09", end: "2026-10-11" });
  });

  it("sorts windows by conflict score ascending", () => {
    const events = [
      { title: "Board Meeting", date: "2026-10-09", importance_score: 9, moveable: false },
      { title: "Board Meeting 2", date: "2026-10-10", importance_score: 9, moveable: false },
    ];
    const windows = generateRecommendedWindows(start, end, 3, "weekend", events, []);
    expect(windows[0].conflict_score).toBeLessThanOrEqual(windows[windows.length - 1].conflict_score);
    expect(windows[windows.length - 1].start).toBe("2026-10-09");
  });
});

describe("parseDurationMinutes", () => {
  it("does not treat a multi-day reservation as a zero-minute event", () => {
    const one = scoreEvent({ title: "Reservation", date: "2026-10-09", allDay: true, duration: "all day" });
    const three = scoreEvent({ title: "Reservation", date: "2026-10-09", allDay: true, duration: "3 days" });
    expect(three.importance_score).toBeGreaterThanOrEqual(one.importance_score);
  });
  it("parses hour and minute strings", () => {
    expect(parseDurationMinutes("2hr", undefined, undefined)).toBe(120);
    expect(parseDurationMinutes("45min", undefined, undefined)).toBe(45);
    expect(parseDurationMinutes("1.5hr", undefined, undefined)).toBe(90);
  });
  it("treats all-day as a long event, not a zero-minute one", () => {
    expect(parseDurationMinutes("all day", undefined, undefined)).toBeGreaterThanOrEqual(480);
    expect(parseDurationMinutes("All Day", undefined, undefined)).toBeGreaterThanOrEqual(480);
  });
});

describe("scoreEvent", () => {
  it("scores critical keywords as fixed and high", () => {
    const r = scoreEvent({ title: "Sarah's Wedding", date: "2026-10-09", time: "3:00 PM", duration: "2hr" });
    expect(r.importance_score).toBeGreaterThanOrEqual(9);
    expect(r.moveable).toBe(false);
  });

  it("scores routine keywords low and moveable", () => {
    const r = scoreEvent({ title: "Team Standup", date: "2026-10-09", time: "9:00 AM", duration: "30min" });
    expect(r.importance_score).toBeLessThanOrEqual(3);
    expect(r.moveable).toBe(true);
  });

  it("treats allDay flag from the API as an important fixed commitment", () => {
    const r = scoreEvent({ title: "Family vacation", date: "2026-10-09", time: "All day", duration: "all day", allDay: true });
    expect(r.importance_score).toBeGreaterThanOrEqual(7);
    expect(r.moveable).toBe(false);
  });

  it("detects all-day from time string even without allDay flag (legacy payloads)", () => {
    const r = scoreEvent({ title: "Offsite retreat day", date: "2026-10-09", time: "All day", duration: "all day" });
    expect(r.moveable).toBe(false);
  });

  it("maps mock importance strings directly", () => {
    const r = scoreEvent({ title: "X", date: "2026-10-09", importance: "critical", moveable: false, time: "1:00 PM", duration: "1hr" });
    expect(r.importance_score).toBe(9);
    expect(r.moveable).toBe(false);
  });
});

describe("generateWindowHistoricalInsight", () => {
  it("matches historical events within +/-4 days by month/day across years", () => {
    const hist = [
      { title: "Annual reunion", date: "2025-10-11" },
      { title: "Far away", date: "2025-03-01" },
    ];
    const r = generateWindowHistoricalInsight("2026-10-09", "2026-10-11", hist);
    expect(r.totalMatches).toBe(1);
    expect(r.years).toEqual([2025]);
  });
});

describe("enrichWindowsWithEvents", () => {
  it("labels windows with fixed events as high severity", () => {
    const events = [
      { title: "A", date: "2026-10-09", importance_score: 8, moveable: false },
      { title: "B", date: "2026-10-10", importance_score: 8, moveable: false },
    ];
    const [w] = enrichWindowsWithEvents([{ start: "2026-10-09", end: "2026-10-11" }], events, []);
    expect(w.aiSeverity).toBe("high");
    expect(w.fixedCount).toBe(2);
  });

  it("does not label unchecked empty windows clear", () => {
    const [w] = enrichWindowsWithEvents([{ start: "2026-10-09", end: "2026-10-11" }], [], []);
    expect(w.aiSeverity).toBe("unknown");
  });

  function canonicalEvent(
    overrides: Partial<CalendarEvent> = {}
  ): CalendarEvent {
    return {
      key: "uid-1",
      providerEventId: "provider-1",
      iCalUID: "uid-1",
      recurringEventId: null,
      originalStart: null,
      title: "Conference",
      description: "",
      location: "",
      interval: {
        kind: "all-day",
        startDate: "2026-10-09",
        endDateExclusive: "2026-10-12",
      },
      occupiedDates: ["2026-10-09", "2026-10-10", "2026-10-11"],
      durationMinutes: null,
      durationDays: 3,
      eventType: "default",
      status: "confirmed",
      transparency: "opaque",
      selfResponse: "accepted",
      attendeeCount: 1,
      blocking: {
        countsAsConflict: true,
        severity: "moderate",
        moveable: true,
        reason: "opaque_event",
      },
      sources: [{ calendarId: "primary", name: "Primary", primary: true }],
      updated: null,
      ...overrides,
    };
  }

  it("indexes a multi-day canonical event on every occupied heatmap date", () => {
    const scored = scoreCalendarEvent(canonicalEvent());
    const index = indexEventsByDate([scored]);

    expect(Object.keys(index)).toEqual([
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(index["2026-10-10"][0].key).toBe("uid-1");
  });

  it("scores a multi-day event once per candidate window", () => {
    const scored = scoreCalendarEvent(canonicalEvent());
    const [window] = enrichWindowsWithEvents(
      [{ start: "2026-10-09", end: "2026-10-11" }],
      [scored],
      []
    );

    expect(window.eventCount).toBe(1);
    expect(window.conflict_score).toBe(scored.importance_score);
    expect(window.windowEvents).toHaveLength(1);
  });

  it("scores duplicate canonical sources once by stable key", () => {
    const first = scoreCalendarEvent(canonicalEvent());
    const duplicate = scoreCalendarEvent(
      canonicalEvent({
        providerEventId: "copy",
        sources: [{ calendarId: "shared", name: "Shared" }],
      })
    );
    const [window] = enrichWindowsWithEvents(
      [{ start: "2026-10-09", end: "2026-10-11" }],
      [first, duplicate],
      []
    );

    expect(window.eventCount).toBe(1);
    expect(window.conflict_score).toBe(first.importance_score);
  });

  it("preserves informational events while giving them zero conflict weight", () => {
    const informational = scoreCalendarEvent(
      canonicalEvent({
        blocking: {
          countsAsConflict: false,
          severity: "none",
          moveable: true,
          reason: "transparent",
        },
      })
    );
    const [window] = enrichWindowsWithEvents(
      [{ start: "2026-10-09", end: "2026-10-11" }],
      [informational],
      []
    );

    expect(informational.importance_score).toBe(0);
    expect(window).toMatchObject({
      conflict_score: 0,
      eventCount: 0,
      aiSeverity: "unknown",
    });
    expect(window.windowEvents).toHaveLength(1);
  });

  it("maps focus time to moderate and out of office to fixed high", () => {
    const focus = scoreCalendarEvent(
      canonicalEvent({
        eventType: "focusTime",
        blocking: {
          countsAsConflict: true,
          severity: "moderate",
          moveable: true,
          reason: "focus_time",
        },
      })
    );
    const away = scoreCalendarEvent(
      canonicalEvent({
        key: "uid-2",
        eventType: "outOfOffice",
        blocking: {
          countsAsConflict: true,
          severity: "high",
          moveable: false,
          reason: "out_of_office",
        },
      })
    );

    expect(focus).toMatchObject({ importance_score: 5, moveable: true });
    expect(away).toMatchObject({ importance_score: 9, moveable: false });
  });

  it.each([
    {
      status: "partial",
      truncated: false,
    },
    {
      status: "complete",
      truncated: true,
    },
  ] satisfies Array<Pick<ScanCoverage, "status" | "truncated">>)(
    "does not label empty $status coverage with truncated=$truncated as clear",
    ({ status, truncated }) => {
      const coverage: ScanCoverage = {
        status,
        requestedCalendarIds: ["primary", "shared"],
        successfulCalendarIds: ["primary"],
        failedCalendars:
          status === "partial"
            ? [{ calendarId: "shared", reason: "forbidden" }]
            : [],
        truncated,
      };
      const [window] = enrichWindowsWithEvents(
        [{ start: "2026-10-09", end: "2026-10-11" }],
        [],
        [],
        coverage
      );

      expect(window.aiSeverity).not.toBe("clear");
      expect(window.summary).toContain("incomplete");
    }
  );
});

describe("buildGroupVotes", () => {
  const organizerDates = ["2037-03-06", "2037-03-13"];
  const responses = [
    {name: "Quinn", selectedDates: ["2037-03-06", "2037-03-13"]},
    {name: "Reed", selectedDates: ["2037-03-13", "2037-03-20"]},
    {name: "Morgan", selectedDates: []},
  ];
  it("counts the organizer and each invented respondent once", () => {
    const votes = buildGroupVotes(organizerDates, "Taylor", responses);
    expect(votes["2037-03-06"]).toEqual({yes: ["Taylor", "Quinn"], no: ["Reed", "Morgan"], total: 4});
    expect(votes["2037-03-13"]).toEqual({yes: ["Taylor", "Quinn", "Reed"], no: ["Morgan"], total: 4});
    expect(votes["2037-03-20"]).toEqual({yes: ["Reed"], no: ["Taylor", "Quinn", "Morgan"], total: 4});
  });
  it("labels an unnamed organizer", () => {
    const votes = buildGroupVotes(organizerDates, "", responses);
    expect(votes["2037-03-06"].yes).toContain("Organizer");
    expect(votes["2037-03-06"].total).toBe(4);
  });
  it("has no dates when nobody supplied one", () => {expect(buildGroupVotes([], "", [])).toEqual({});});
});

describe("validateClusters", () => {
  const events = [
    { id: "e1", date: "2025-10-12" },
    { id: "e2", date: "2025-10-16" },
    { id: "e3", date: "2025-10-14" },
    { id: "e4", date: "2025-11-01" },
  ];

  it("accepts valid clusters and computes date ranges from events", () => {
    const raw = { clusters: [{ label: "Trip to San Francisco", emoji: "✈️", eventIds: ["e1", "e3", "e2"] }] };
    const out = validateClusters(events, raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "c0", label: "Trip to San Francisco", emoji: "✈️", startDate: "2025-10-12", endDate: "2025-10-16" });
    expect(out[0].eventIds.sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("drops unknown event ids and then singleton clusters", () => {
    const raw = { clusters: [
      { label: "Ghost", eventIds: ["nope1", "nope2"] },
      { label: "Half ghost", eventIds: ["e1", "nope"] },
      { label: "Real", eventIds: ["e1", "e2"] },
    ] };
    const out = validateClusters(events, raw);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Real");
  });

  it("drops ids already claimed by an earlier cluster", () => {
    const raw = { clusters: [
      { label: "First", eventIds: ["e1", "e2"] },
      { label: "Second", eventIds: ["e2", "e3"] },
    ] };
    const out = validateClusters(events, raw);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("First");
  });

  it("deduplicates repeated ids before enforcing the two-member minimum", () => {
    const raw = {
      clusters: [
        { label: "Duplicate singleton", eventIds: ["e1", "e1"] },
        { label: "Real pair", eventIds: ["e2", "e2", "e3"] },
      ],
    };

    const out = validateClusters(events, raw);

    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Real pair");
    expect(out[0].eventIds).toEqual(["e2", "e3"]);
  });

  it("returns [] for garbage input", () => {
    expect(validateClusters(events, null)).toEqual([]);
    expect(validateClusters(events, "nonsense")).toEqual([]);
    expect(validateClusters(events, { clusters: "x" })).toEqual([]);
    expect(validateClusters(events, { clusters: [{ label: 5, eventIds: ["e1", "e2"] }] })).toEqual([]);
  });
});

describe("findCandidateStart", () => {
  const windows = [
    { start: "2026-10-01", end: "2026-10-03" },
    { start: "2026-10-02", end: "2026-10-04" },
    { start: "2026-10-03", end: "2026-10-05" },
  ];

  it("requires an exact candidate start for custom calendar selection", () => {
    expect(findCandidateStart("2026-10-03", windows, "custom")).toBe("2026-10-03");
    expect(findCandidateStart("2026-10-04", windows, "custom")).toBeNull();
  });

  it("retains overlapping-window selection for fixed presets", () => {
    expect(findCandidateStart("2026-10-03", windows, "weekend")).toBe("2026-10-01");
  });
});

describe("groupEventsByCluster", () => {
  const clusters = [
    { id: "c0", label: "Trip to SF", emoji: "✈️", startDate: "2025-10-12", endDate: "2025-10-16", eventIds: ["e1", "e2"] },
  ];
  const hist = buildHistClusters(clusters);
  const evts = [
    { id: "e1", date: "2025-10-12", title: "Flight to SFO" },
    { id: "e2", date: "2025-10-16", title: "Hotel checkout" },
    { id: "e9", date: "2025-10-13", title: "Dentist" },
  ];

  it("partitions events into cluster groups and singles", () => {
    const { clusters: groups, singles } = groupEventsByCluster(evts, hist);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Trip to SF");
    expect(groups[0].events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(singles.map((e) => e.id)).toEqual(["e9"]);
  });

  it("handles partial cluster membership in a window slice", () => {
    const { clusters: groups, singles } = groupEventsByCluster([evts[0], evts[2]], hist);
    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((e) => e.id)).toEqual(["e1"]);
    expect(singles.map((e) => e.id)).toEqual(["e9"]);
  });

  it("null cluster map -> everything is a single", () => {
    const { clusters: groups, singles } = groupEventsByCluster(evts, null);
    expect(groups).toEqual([]);
    expect(singles).toHaveLength(3);
  });
});

describe("generateWindowHistoricalInsight — weekday filtering", () => {
  // Window 2026-10-09..11 is Fri–Sun
  const weekendWindow = ["2026-10-09", "2026-10-11"];

  it("excludes weekday events from a weekend window even inside the fuzzy date range", () => {
    const hist = [
      { title: "Tuesday dentist", date: "2025-10-14" }, // Tue, within ±4d of Oct 9-11
      { title: "Saturday reunion", date: "2025-10-11" }, // Sat
    ];
    const r = generateWindowHistoricalInsight(weekendWindow[0], weekendWindow[1], hist);
    expect(r.totalMatches).toBe(1);
    expect(r.byYear[2025][0].title).toBe("Saturday reunion");
  });

  it("single-day window matches only the same weekday", () => {
    // 2026-10-07 is a Wednesday
    const hist = [
      { title: "Wed thing", date: "2025-10-08" },  // Wed 2025, within fuzz
      { title: "Thu thing", date: "2025-10-09" },  // Thu
    ];
    const r = generateWindowHistoricalInsight("2026-10-07", "2026-10-07", hist);
    expect(r.totalMatches).toBe(1);
    expect(r.byYear[2025][0].title).toBe("Wed thing");
  });

  it("week-long window matches all weekdays (no filter effect)", () => {
    // 2026-10-05 (Mon) .. 2026-10-11 (Sun)
    const hist = [
      { title: "Tue thing", date: "2025-10-07" },
      { title: "Sat thing", date: "2025-10-11" },
    ];
    const r = generateWindowHistoricalInsight("2026-10-05", "2026-10-11", hist);
    expect(r.totalMatches).toBe(2);
  });
});

describe("travel adjacency on enriched windows", () => {
  const invented: AwaySpan[] = [
    {startDate: "2037-05-11", endDate: "2037-05-13", label: "Seed exchange", source: "multi-day", confidence: "high"},
    {startDate: "2037-05-27", endDate: "2037-05-27", label: "Travel day", source: "flight-chain", confidence: "low"},
  ];
  it("preserves output when no travel evidence exists", () => {
    const windows = [{start: "2037-05-02", end: "2037-05-04"}];
    expect(enrichWindowsWithEvents(windows, [], [], undefined, [])).toEqual(enrichWindowsWithEvents(windows, [], []));
    expect(enrichWindowsWithEvents(windows, [], [])[0].travelAdjacency).toBeNull();
  });
  it("keeps unknown calendar coverage separate from an evidenced travel warning", () => {
    const [window] = enrichWindowsWithEvents([{start: "2037-05-15", end: "2037-05-17"}], [], [], undefined, invented);
    expect(window.aiSeverity).toBe("unknown");
    expect(window.travelAdjacency).toMatchObject({severity: "high", direction: "before", gapDays: 1});
  });
  it("passes all independent spans through date recommendation", () => {
    const windows = generateRecommendedWindows("2037-05-01", "2037-05-31", 3, "weekend", [], [], undefined, invented);
    expect(windows.some(entry => entry.travelAdjacency?.span.label === "Seed exchange")).toBe(true);
  });
});
