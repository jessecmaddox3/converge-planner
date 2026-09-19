import { describe, expect, it } from "vitest";
import { assessWindow, groupDateFamilies, suggestDiverseWindows, tripBounds } from "./scheduling";
import { generateRecommendedWindows, type AnalyzedEvent } from "./analysis";
import type { ScanCoverage } from "./calendar/types";

const complete: ScanCoverage = { status: "complete", requestedCalendarIds: ["primary"], successfulCalendarIds: ["primary"], failedCalendars: [], truncated: false };
const window = { start: "2026-10-09", end: "2026-10-11" };
const timing = { timeZone: "America/New_York" };
function event(start: string, end: string, extra: Partial<AnalyzedEvent> = {}): AnalyzedEvent {
  return { date: "2026-10-09", title: "Meeting", importance_score: 3, moveable: true,
    interval: { kind: "timed", start, end }, ...extra };
}

describe("window assessment", () => {
  it("unions simultaneous busy time instead of counting it twice", () => {
    const result = assessWindow(window, [
      event("2026-10-09T09:00:00-04:00", "2026-10-09T11:00:00-04:00"),
      event("2026-10-09T10:00:00-04:00", "2026-10-09T12:00:00-04:00"),
    ], complete, timing);
    expect(result.busyMinutes).toBe(180);
  });
  it("excludes Friday morning commitments before an evening departure", () => {
    const result = assessWindow(window, [event("2026-10-09T09:00:00-04:00", "2026-10-09T11:00:00-04:00", { moveable: false })], complete, { ...timing, departureTime: "18:00", returnTime: "18:00" });
    expect(result.busyMinutes).toBe(0);
    expect(result.inferredBlockers).toBe(0);
    expect(result.events).toHaveLength(0);
  });
  it("keeps missing coverage distinct from a clear calendar", () => {
    const result = assessWindow(window, [], { ...complete, status: "partial" }, timing);
    expect(result.confidence).toBe("incomplete");
    expect(result.severity).toBe("unknown");
    expect(result.reason).toMatch(/incomplete/i);
    expect(assessWindow(window, [], undefined, timing).confidence).toBe("not-checked");
  });
  it("gives explicit overrides precedence over inferred importance", () => {
    const result = assessWindow(window, [
      event("2026-10-09T09:00:00-04:00", "2026-10-09T10:00:00-04:00", { override: "must-attend" }),
      event("2026-10-09T10:00:00-04:00", "2026-10-09T11:00:00-04:00", { override: "ignore", moveable: false }),
      event("2026-10-09T11:00:00-04:00", "2026-10-09T12:00:00-04:00", { override: "can-move", moveable: false }),
    ], complete, timing);
    expect(result.hardBlockers).toBe(1);
    expect(result.inferredBlockers).toBe(0);
    expect(result.busyMinutes).toBe(120);
  });
  it("clips a spanning all-day commitment to the actual three-day window", () => {
    const result = assessWindow(window, [{ date: "2026-10-07", moveable: false, interval: { kind: "all-day", startDate: "2026-10-07", endDateExclusive: "2026-10-14" } }], complete, timing);
    expect(result.busyMinutes).toBe(4320);
    expect(result.inferredBlockers).toBe(1);
  });
});

describe("exact date families", () => {
  const windows = generateRecommendedWindows("2026-10-02", "2027-01-02", 3, "custom", [], [], complete);
  it("retains every variant without transitively merging a season", () => {
    const families = groupDateFamilies(windows);
    expect(windows).toHaveLength(91);
    expect(families.length).toBeGreaterThan(20);
    const dates = families.flatMap((family) => family.variants.map((variant) => variant.start));
    expect(dates).toHaveLength(91);
    expect(new Set(dates).size).toBe(91);
    for (const family of families) for (const variant of family.variants) {
      expect(Math.abs(Date.parse(variant.start) - Date.parse(family.representative.start))).toBeLessThanOrEqual(172800000);
    }
  });
  it("suggests three nonoverlapping options without dropping the alternatives", () => {
    const selected = suggestDiverseWindows(windows, 3);
    expect(selected).toHaveLength(3);
    for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
      expect(selected[i].end < selected[j].start || selected[j].end < selected[i].start).toBe(true);
    }
    expect(windows).toHaveLength(91);
  });
});

describe("trip wall-clock bounds", () => {
  it("uses the trip timezone across the fall daylight-saving transition", () => {
    const bounds = tripBounds({ start: "2026-10-30", end: "2026-11-01" }, { timeZone: "America/New_York", departureTime: "18:00", returnTime: "18:00" });
    expect(new Date(bounds.start).toISOString()).toBe("2026-10-30T22:00:00.000Z");
    expect(new Date(bounds.end).toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
  it("rejects nonexistent or ambiguous custom times instead of shifting the trip silently", () => {
    expect(() => tripBounds({ start: "2026-03-08", end: "2026-03-08" }, { timeZone: "America/New_York", departureTime: "02:30", returnTime: "18:00" })).toThrow();
    expect(() => tripBounds({ start: "2026-11-01", end: "2026-11-01" }, { timeZone: "America/New_York", departureTime: "01:30", returnTime: "18:00" })).toThrow();
  });
});
