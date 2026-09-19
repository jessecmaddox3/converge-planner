import { Temporal } from "@js-temporal/polyfill";
import type { AnalyzedEvent, EnrichedWindow, WindowRange } from "./analysis";
import { addCalendarDays } from "./calendar/range";
import type { ScanCoverage } from "./calendar/types";

export interface TripTiming {
  timeZone: string;
  departureTime?: string;
  returnTime?: string;
}

export interface WindowAssessment {
  hardBlockers: number;
  inferredBlockers: number;
  busyMinutes: number;
  estimatedTime: boolean;
  confidence: "complete" | "incomplete" | "not-checked";
  severity: "high" | "moderate" | "low" | "clear" | "unknown";
  reason: string;
  events: AnalyzedEvent[];
}

function midnight(date: string, timeZone: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime(timeZone).epochMilliseconds;
}

export function tripBounds(window: WindowRange, timing: TripTiming): { start: number; end: number } {
  const instant = (date: string, time: string) => Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(timing.timeZone, { disambiguation: "reject" }).epochMilliseconds;
  const start = timing.departureTime ? instant(window.start, timing.departureTime) : midnight(window.start, timing.timeZone);
  const end = timing.returnTime ? instant(window.end, timing.returnTime) : midnight(addCalendarDays(window.end, 1), timing.timeZone);
  if (end <= start) throw new RangeError("Return time must be after departure time");
  return { start, end };
}

export function assessWindow(
  window: WindowRange,
  events: AnalyzedEvent[],
  coverage?: ScanCoverage,
  timing: TripTiming = { timeZone: "UTC" },
): WindowAssessment {
  const bounds = tripBounds(window, timing);
  const spans: { start: number; end: number }[] = [];
  const included: AnalyzedEvent[] = [];
  const seen = new Set<string>();
  let estimatedTime = false;
  let unlocatedMinutes = 0;
  for (const event of events) {
    if (event.override === "ignore" || (event.countsAsConflict === false && event.override !== "must-attend")) continue;
    if (event.key && seen.has(event.key)) continue;
    if (event.key) seen.add(event.key);
    const interval = event.interval;
    let span: { start: number; end: number };
    if (interval?.kind === "timed") {
      span = { start: Date.parse(interval.start), end: Date.parse(interval.end) };
    } else if (interval?.kind === "all-day") {
      span = { start: midnight(interval.startDate, timing.timeZone), end: midnight(interval.endDateExclusive, timing.timeZone) };
    } else {
      const dates = (event.occupiedDates?.length ? event.occupiedDates : [event.date]).filter((date) => date >= window.start && date <= window.end);
      if (!dates.length) continue;
      // Old/demo records lack instants. Do not invent simultaneous times for them.
      estimatedTime = true;
      unlocatedMinutes += Math.max(0, event.durationMinutes ?? 60);
      included.push(event);
      continue;
    }
    const clipped = { start: Math.max(bounds.start, span.start), end: Math.min(bounds.end, span.end) };
    if (!Number.isFinite(clipped.start) || !Number.isFinite(clipped.end) || clipped.end <= clipped.start) continue;
    spans.push(clipped);
    included.push(event);
  }
  spans.sort((a, b) => a.start - b.start);
  let merged: { start: number; end: number } | null = null;
  let milliseconds = 0;
  for (const span of spans) {
    if (!merged) merged = { ...span };
    else if (span.start <= merged.end) merged.end = Math.max(merged.end, span.end);
    else { milliseconds += merged.end - merged.start; merged = { ...span }; }
  }
  if (merged) milliseconds += merged.end - merged.start;
  const busyMinutes = Math.round(milliseconds / 60000 + unlocatedMinutes);
  const hardBlockers = included.filter((event) => event.override === "must-attend").length;
  const inferredBlockers = included.filter((event) => event.override !== "must-attend" && event.override !== "can-move" && event.moveable === false).length;
  const confidence = !coverage ? "not-checked" : coverage.status === "complete" && !coverage.truncated ? "complete" : "incomplete";
  const severity = hardBlockers || inferredBlockers >= 2 ? "high" : inferredBlockers ? "moderate" : included.length ? "low" : confidence === "complete" ? "clear" : "unknown";
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  let reason = hardBlockers ? `${plural(hardBlockers, "must-attend commitment")}`
    : inferredBlockers ? `${plural(inferredBlockers, "likely fixed commitment")} to review`
    : included.length ? `${plural(included.length, "commitment")} to review`
    : confidence === "complete" ? "No conflicts in the calendars checked"
    : confidence === "incomplete" ? "Calendar coverage is incomplete; no conflicts found in loaded calendars"
    : "Calendar not checked";
  if (included.length && confidence !== "complete") reason += confidence === "incomplete" ? "; calendar coverage is incomplete" : "; calendar not fully checked";
  return { hardBlockers, inferredBlockers, busyMinutes, estimatedTime, confidence, severity, reason, events: included };
}

export function compareWindows(a: EnrichedWindow, b: EnrichedWindow): number {
  const first = a.assessment;
  const second = b.assessment;
  if (first && second) {
    // Missing data is never treated as a verified zero. Within each confidence
    // group, explicit blockers precede inferred commitments and occupied time.
    const certainty = { complete: 0, incomplete: 1, "not-checked": 2 };
    return certainty[first.confidence] - certainty[second.confidence]
      || first.hardBlockers - second.hardBlockers
      || first.inferredBlockers - second.inferredBlockers
      || first.busyMinutes - second.busyMinutes
      || a.start.localeCompare(b.start);
  }
  return a.fixedCount - b.fixedCount || a.conflict_score - b.conflict_score || a.start.localeCompare(b.start);
}

export interface DateFamily {
  id: string;
  representative: EnrichedWindow;
  variants: EnrichedWindow[];
}

export function groupDateFamilies(windows: EnrichedWindow[]): DateFamily[] {
  const families: DateFamily[] = [];
  for (const window of windows) {
    const family = families.find(({ representative: anchor }) => {
      const delta = Math.abs(Date.parse(window.start) - Date.parse(anchor.start)) / 86400000;
      const overlap = (Math.min(Date.parse(window.end), Date.parse(anchor.end)) - Math.max(Date.parse(window.start), Date.parse(anchor.start))) / 86400000 + 1;
      const days = (Date.parse(window.end) - Date.parse(window.start)) / 86400000 + 1;
      return delta <= 2 && overlap / days >= 0.5
        && window.fixedCount === anchor.fixedCount
        && window.assessment?.hardBlockers === anchor.assessment?.hardBlockers;
    });
    if (family) family.variants.push(window);
    else families.push({ id: `${window.start}/${window.end}`, representative: window, variants: [window] });
  }
  for (const family of families) family.variants.sort((a, b) => a.start.localeCompare(b.start));
  return families;
}

export function suggestDiverseWindows(windows: EnrichedWindow[], count = 3): EnrichedWindow[] {
  const selected: EnrichedWindow[] = [];
  for (const window of windows) {
    if (selected.length >= count) break;
    if (selected.every((other) => window.end < other.start || window.start > other.end)) selected.push(window);
  }
  return selected;
}
