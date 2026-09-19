// Pure scheduling/scoring logic shared by the Converge UI.
// No React, no network, no logging — keep this file testable.

import type {
  CalendarEvent,
  CalendarSource,
  ScanCoverage,
} from "@/lib/calendar/types";
import { travelAdjacency } from "@/lib/calendar/away";
import type { AwaySpan, TravelAdjacency } from "@/lib/calendar/away";
import { assessWindow, compareWindows, type TripTiming, type WindowAssessment } from "./scheduling";
import type { EventInterval } from "./calendar/types";

export interface RawEvent {
  title?: string;
  summary?: string;
  date: string;
  time?: string;
  duration?: string;
  start?: string;
  end?: string;
  importance?: string;
  moveable?: boolean;
  recurring?: boolean;
  recurringEventId?: string;
  allDay?: boolean;
  calendar?: string;
  location?: string;
  attendees?: number;
  attendeeCount?: number;
  description?: string;
}

export interface ScoredEvent {
  title: string;
  date: string;
  time: string;
  duration: string;
  importance_score: number;
  moveable: boolean;
  move_difficulty: "easy" | "moderate" | "hard" | "impossible";
  reasoning: string;
  calendar: string;
  location: string;
  attendees: number;
  recurring: boolean;
  description: string;
}

export interface WindowRange {
  start: string;
  end: string;
}

export function findCandidateStart(
  date: string,
  windows: WindowRange[] | null | undefined,
  preset: string
): string | null {
  if (!windows) return null;
  const window = preset === "custom"
    ? windows.find((candidate) => candidate.start === date)
    : windows.find((candidate) => date >= candidate.start && date <= candidate.end);
  return window?.start || null;
}

export interface HistoricalInsight {
  byYear: Record<number, RawEvent[]>;
  years: number[];
  totalMatches: number;
  seasonalInsights: { text: string; risk: string; icon: string }[];
}

export type AnalyzedEvent = Partial<ScoredEvent> & {
  id?: string;
  date: string;
  key?: string;
  occupiedDates?: string[];
  countsAsConflict?: boolean;
  eventType?: string;
  sources?: CalendarSource[];
  interval?: EventInterval;
  durationMinutes?: number | null;
  override?: "must-attend" | "can-move" | "ignore";
};

export interface EnrichedWindow extends WindowRange {
  conflict_score: number;
  fixedCount: number;
  highCount: number;
  eventCount: number;
  topConflict: AnalyzedEvent | null;
  windowEvents: AnalyzedEvent[];
  historicalInsight: HistoricalInsight;
  aiSeverity: WindowAssessment["severity"];
  summary: string;
  travelAdjacency?: TravelAdjacency | null;
  coverage?: ScanCoverage;
  assessment?: WindowAssessment;
}

export interface GroupVote {
  yes: string[];
  no: string[];
  total: number;
}

export type GroupVotes = Record<string, GroupVote>;

export function formatLocalDate(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

const ALL_DAY_RE = /all.?day/i;

export function parseDurationMinutes(
  durationStr: string | undefined,
  start: string | undefined,
  end: string | undefined
): number {
  if (durationStr) {
    if (ALL_DAY_RE.test(durationStr)) return 480; // treat all-day as a long block, not 0 minutes
    const days = durationStr.match(/([\d.]+)\s*days?/i);
    if (days) return Number(days[1]) * 1440;
    const h = durationStr.match(/([\d.]+)\s*h/i);
    const m = durationStr.match(/(\d+)\s*m/i);
    return (h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0);
  }
  if (start && end) {
    return (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  }
  return 60; // default
}

export function formatEventTime(startStr: string | undefined): string {
  if (!startStr) return "";
  try {
    const d = new Date(startStr);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

export function formatDurationFromStartEnd(start?: string, end?: string): string {
  if (!start || !end) return "1hr";
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  if (mins >= 60) return Math.round(mins / 60) + "hr";
  return mins + "min";
}

export function scoreEvent(event: RawEvent): ScoredEvent {
  // Mock events already have an importance string — convert directly
  const importanceMap: Record<string, number> = { critical: 9, high: 7, medium: 5, low: 3 };
  if (event.importance && importanceMap[event.importance] !== undefined) {
    const score = importanceMap[event.importance];
    return {
      title: event.title || "Untitled",
      date: event.date,
      time: event.time || "",
      duration: event.duration || "1hr",
      importance_score: score,
      moveable: event.moveable !== undefined ? event.moveable : score < 7,
      move_difficulty: event.moveable === false ? "impossible" : score >= 7 ? "hard" : "moderate",
      reasoning: event.moveable === false ? "Fixed commitment." : "Could likely be rescheduled.",
      calendar: event.calendar || "",
      location: event.location || "",
      attendees: event.attendees || 0,
      recurring: !!event.recurring,
      description: event.description || "",
    };
  }

  // Real Google Calendar events — score from signals
  const title = (event.title || event.summary || "").toLowerCase();
  let score = 5; // baseline
  let moveable = true;
  let reasoning = "Regular event.";

  // Title keyword matching
  const critical = /wedding|funeral|flight|interview|surgery|graduation|commencement|bar mitzvah|bat mitzvah/;
  const high = /board meeting|doctor|recital|conference|presentation|demo|review|all[- ]?hands|offsite|deadline/;
  const low = /standup|stand-up|1[:\-]1|one-on-one|coffee|yoga|lunch|book club|happy hour|sync|check[- ]?in/;

  if (critical.test(title)) { score = 9; moveable = false; reasoning = "Major life event."; }
  else if (high.test(title)) { score = 7; reasoning = "Important commitment."; }
  else if (low.test(title)) { score = 2; reasoning = "Routine, easily moved."; }

  // Attendee signals
  const attendees = event.attendees || event.attendeeCount || 0;
  if (attendees >= 10) { score += 2; moveable = false; reasoning = "Large group event."; }
  else if (attendees >= 4) { score += 1; }

  // All-day events tend to be important. The events API sends allDay; older
  // payloads only carry it in the time/duration strings.
  const isAllDay = event.allDay === true || event.time === "All day" || ALL_DAY_RE.test(event.duration || "");
  if (isAllDay) { score += 2; moveable = false; reasoning = "All-day commitment."; }

  // Recurring events — just one instance, easier to skip
  if (event.recurring || event.recurringEventId) { score -= 1; reasoning = (reasoning === "Regular event." ? "Recurring, one instance." : reasoning); }

  // Location present means travel was planned
  if (event.location) { score += 1; }

  // Duration signals
  const dur = parseDurationMinutes(event.duration, event.start, event.end);
  if (dur >= 180) { score += 1; }
  else if (dur <= 30) { score -= 1; }

  // Clamp
  score = Math.max(1, Math.min(10, score));

  const move_difficulty = !moveable ? "impossible" : score >= 7 ? "hard" : score >= 4 ? "moderate" : "easy";

  return {
    title: event.title || event.summary || "Untitled",
    date: event.date,
    time: event.time || formatEventTime(event.start),
    duration: event.duration || formatDurationFromStartEnd(event.start, event.end),
    importance_score: score,
    moveable,
    move_difficulty,
    reasoning,
    calendar: event.calendar || "",
    location: event.location || "",
    attendees,
    recurring: !!(event.recurring || event.recurringEventId),
    description: event.description || "",
  };
}

export function scoreCalendarEvent(event: CalendarEvent): AnalyzedEvent {
  const date = event.occupiedDates[0] || "";
  const timedInterval = event.interval.kind === "timed" ? event.interval : null;
  const base = scoreEvent({
    title: event.title,
    date,
    time: timedInterval ? formatEventTime(timedInterval.start) : "All day",
    duration: timedInterval
      ? formatDurationFromStartEnd(timedInterval.start, timedInterval.end)
      : event.durationDays === 1
        ? "all day"
        : `${event.durationDays || 1} days`,
    start: timedInterval?.start,
    end: timedInterval?.end,
    allDay: !timedInterval,
    recurring: Boolean(event.recurringEventId),
    calendar: event.sources.map((source) => source.name).join(", "),
    location: event.location,
    attendees: event.attendeeCount,
    description: event.description,
  });

  if (!event.blocking.countsAsConflict) {
    base.importance_score = 0;
    base.moveable = true;
    base.move_difficulty = "easy";
    base.reasoning = "Informational calendar event.";
  } else if (event.eventType === "focusTime") {
    base.importance_score = 5;
    base.moveable = true;
    base.move_difficulty = "moderate";
    base.reasoning = "Focus time.";
  } else if (event.eventType === "outOfOffice") {
    base.importance_score = 9;
    base.moveable = false;
    base.move_difficulty = "impossible";
    base.reasoning = "Out of office.";
  }

  return {
    ...base,
    id: event.key,
    key: event.key,
    interval: { ...event.interval },
    durationMinutes: event.durationMinutes ?? (event.durationDays ?? 1) * 1440,
    occupiedDates: [...event.occupiedDates],
    countsAsConflict: event.blocking.countsAsConflict,
    eventType: event.eventType,
    sources: event.sources.map((source) => ({ ...source })),
  };
}

function datesForAnalyzedEvent(event: AnalyzedEvent): string[] {
  return event.occupiedDates?.length ? event.occupiedDates : [event.date];
}

export function indexEventsByDate(
  events: AnalyzedEvent[] | null | undefined
): Record<string, AnalyzedEvent[]> {
  const byDate: Record<string, AnalyzedEvent[]> = {};
  (events || []).forEach((event, index) => {
    const identity = event.key || `legacy:${index}`;
    for (const date of datesForAnalyzedEvent(event)) {
      if (!byDate[date]) byDate[date] = [];
      if (!byDate[date].some((existing, existingIndex) =>
        (existing.key || `legacy:${existingIndex}`) === identity
      )) {
        byDate[date].push(event);
      }
    }
  });
  return byDate;
}

// Generate historical insight for a specific window based on real past events
export function generateWindowHistoricalInsight(
  windowStart: string,
  windowEnd: string,
  historicalEvents: RawEvent[] | null | undefined
): HistoricalInsight {
  const seasonalInsights: HistoricalInsight["seasonalInsights"] = [];

  if (!historicalEvents || historicalEvents.length === 0) {
    return { byYear: {}, years: [], totalMatches: 0, seasonalInsights: seasonalInsights };
  }

  // Find historical events near the same calendar dates (month/day) from prior years.
  // Expand by +/- 4 days to catch equivalent weekends that shift by 1-2 days across years.
  const wStart = new Date(windowStart + "T12:00:00");
  const wEnd = new Date(windowEnd + "T12:00:00");
  const fuzzyStart = new Date(wStart); fuzzyStart.setDate(fuzzyStart.getDate() - 4);
  const fuzzyEnd = new Date(wEnd); fuzzyEnd.setDate(fuzzyEnd.getDate() + 4);
  const startMD = (fuzzyStart.getMonth() + 1) * 100 + fuzzyStart.getDate();
  const endMD = (fuzzyEnd.getMonth() + 1) * 100 + fuzzyEnd.getDate();

  // The window's weekdays (e.g. Fri/Sat/Sun for a weekend). Historical events
  // only count if they fall on one of them — a Tuesday dentist visit from
  // last October says nothing about this year's Oct 9–11 weekend.
  const windowWeekdays = new Set<number>();
  for (const d = new Date(wStart); d <= wEnd && windowWeekdays.size < 7; d.setDate(d.getDate() + 1)) {
    windowWeekdays.add(d.getDay());
  }

  const matches = historicalEvents.filter((evt) => {
    const ed = new Date(evt.date + "T12:00:00");
    if (!windowWeekdays.has(ed.getDay())) return false;
    const md = (ed.getMonth() + 1) * 100 + ed.getDate();
    return startMD <= endMD ? md >= startMD && md <= endMD : md >= startMD || md <= endMD;
  });

  if (matches.length === 0) {
    return { byYear: {}, years: [], totalMatches: 0, seasonalInsights: seasonalInsights };
  }

  // Group all matching events by year
  const byYear: Record<number, RawEvent[]> = {};
  for (const evt of matches) {
    const year = new Date(evt.date + "T12:00:00").getFullYear();
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(evt);
  }
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  return { byYear, years, totalMatches: matches.length, seasonalInsights };
}

// Enrich windows with event data, historical insight, and severity labels.
export function enrichWindowsWithEvents(
  windows: WindowRange[],
  analyzedEvents: AnalyzedEvent[] | null | undefined,
  historicalEvents: RawEvent[] | null | undefined,
  coverage?: ScanCoverage,
  awaySpans: AwaySpan[] = [],
  timing?: TripTiming,
): EnrichedWindow[] {
  return windows.map((w) => {
    const unique = new Map<string, { event: AnalyzedEvent; index: number }>();
    (analyzedEvents || []).forEach((event, index) => {
      const overlappingDate = datesForAnalyzedEvent(event)
        .find((date) => date >= w.start && date <= w.end);
      if (!overlappingDate) return;
      const identity = event.key || `legacy:${index}`;
      if (!unique.has(identity)) {
        unique.set(identity, {
          event: { ...event, date: overlappingDate },
          index,
        });
      }
    });
    const candidates = Array.from(unique.values()).map(({ event }) => event);
    const assessment = assessWindow(w, candidates, coverage, timing);
    const conflicts = assessment.events;
    const windowEvents = candidates.filter((event) => conflicts.includes(event) || event.countsAsConflict === false || event.override === "ignore");
    const totalScore = conflicts.reduce(
      (total, event) => total + (event.importance_score || 0),
      0
    );
    const fixedCount = assessment.hardBlockers + assessment.inferredBlockers;
    const highCount = conflicts.filter((event) => (event.importance_score || 0) >= 7).length;
    const eventCount = conflicts.length;
    const topConflict = conflicts.reduce<AnalyzedEvent | null>(
      (top, event) =>
        !top || (event.importance_score || 0) > (top.importance_score || 0)
          ? event
          : top,
      null
    );

    // Historical insight for this window
    const historicalInsight = generateWindowHistoricalInsight(w.start, w.end, historicalEvents);

    const aiSeverity = assessment.severity;
    const summary = assessment.reason;

    const travel = travelAdjacency(w, awaySpans);

    return { ...w, conflict_score: totalScore, fixedCount, highCount, eventCount, topConflict, windowEvents, historicalInsight, aiSeverity, summary, coverage, travelAdjacency: travel, assessment };
  });
}

export function generateRecommendedWindows(
  start: string,
  end: string,
  duration: number,
  preset: string,
  analyzedEvents: AnalyzedEvent[] | null | undefined,
  historicalEvents: RawEvent[] | null | undefined,
  coverage?: ScanCoverage,
  awaySpans: AwaySpan[] = [],
  timing?: TripTiming,
): EnrichedWindow[] {
  const windows: WindowRange[] = [];
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  const cur = new Date(s);

  // Generate candidate windows based on preset
  if (preset === "day") {
    while (cur <= e) {
      const ds = formatLocalDate(cur);
      windows.push({ start: ds, end: ds });
      cur.setDate(cur.getDate() + 1);
    }
  } else if (preset === "weekend") {
    while (cur <= e) {
      if (cur.getDay() === 5) {
        const fri = formatLocalDate(cur);
        const sun = new Date(cur); sun.setDate(sun.getDate() + 2);
        if (sun <= e) windows.push({ start: fri, end: formatLocalDate(sun) });
      }
      cur.setDate(cur.getDate() + 1);
    }
  } else if (preset === "week") {
    while (cur <= e) {
      if (cur.getDay() === 1) {
        const mon = formatLocalDate(cur);
        const sun = new Date(cur); sun.setDate(sun.getDate() + 6);
        if (sun <= e) windows.push({ start: mon, end: formatLocalDate(sun) });
      }
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    while (cur <= e) {
      const ws = formatLocalDate(cur);
      const we = new Date(cur); we.setDate(we.getDate() + duration - 1);
      if (we <= e) windows.push({ start: ws, end: formatLocalDate(we) });
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Enrich and sort by conflict score
  return enrichWindowsWithEvents(windows, analyzedEvents, historicalEvents, coverage, awaySpans, timing).sort(compareWindows);
}

// Build the per-window group vote tally shown to invitees.
// Participants are the organizer (implicitly "yes" on every date they proposed)
// plus everyone who has responded.
export function buildGroupVotes(
  organizerSelectedDates: string[] | null | undefined,
  organizerName: string | null | undefined,
  responses: { name: string; selectedDates: string[] }[] | null | undefined
): GroupVotes {
  const orgDates = organizerSelectedDates || [];
  const resp = responses || [];
  const orgName = (organizerName || "").trim() || "Organizer";

  const allDates = new Set<string>(orgDates);
  resp.forEach((r) => (r.selectedDates || []).forEach((d) => allDates.add(d)));
  if (allDates.size === 0) return {};

  const total = resp.length + (orgDates.length > 0 || resp.length > 0 ? 1 : 0);
  const votes: GroupVotes = {};
  for (const date of Array.from(allDates)) {
    const yes: string[] = [];
    const no: string[] = [];
    if (orgDates.includes(date)) yes.push(orgName);
    else no.push(orgName);
    for (const r of resp) {
      if ((r.selectedDates || []).includes(date)) yes.push(r.name);
      else no.push(r.name);
    }
    votes[date] = { yes, no, total };
  }
  return votes;
}

// ── AI history summarization ────────────────────────────────────────────

export interface SummaryCluster {
  id: string;
  label: string;
  emoji: string;
  startDate: string;
  endDate: string;
  eventIds: string[];
}

export interface HistClusters {
  byEventId: Record<string, string>;
  clusters: Record<string, { label: string; emoji: string; startDate: string; endDate: string; eventCount: number }>;
}

// Validate the model's raw clustering output against the events we actually
// sent. Rules: event ids must exist, an id belongs to at most one cluster,
// clusters need >= 2 surviving members. Date ranges are computed here from
// the member events — the model never does date math.
export function validateClusters(
  events: { id: string; date: string }[],
  raw: unknown
): SummaryCluster[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { clusters?: unknown }).clusters;
  if (!Array.isArray(list)) return [];

  const dateById = new Map(events.map((e) => [e.id, e.date]));
  const claimed = new Set<string>();
  const out: SummaryCluster[] = [];

  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const label = (c as { label?: unknown }).label;
    const eventIds = (c as { eventIds?: unknown }).eventIds;
    const emoji = (c as { emoji?: unknown }).emoji;
    if (typeof label !== "string" || !label.trim()) continue;
    if (!Array.isArray(eventIds)) continue;

    const valid = Array.from(new Set(eventIds.filter(
      (id): id is string => typeof id === "string" && dateById.has(id) && !claimed.has(id)
    )));
    if (valid.length < 2) continue;

    valid.forEach((id) => claimed.add(id));
    const dates = valid.map((id) => dateById.get(id)!).sort();
    out.push({
      id: "c" + out.length,
      label: label.trim().slice(0, 60),
      emoji: typeof emoji === "string" && emoji.length > 0 && emoji.length <= 8 ? emoji : "📅",
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      eventIds: valid,
    });
  }
  return out;
}

export function buildHistClusters(clusters: SummaryCluster[]): HistClusters {
  const byEventId: HistClusters["byEventId"] = {};
  const meta: HistClusters["clusters"] = {};
  for (const c of clusters) {
    meta[c.id] = { label: c.label, emoji: c.emoji, startDate: c.startDate, endDate: c.endDate, eventCount: c.eventIds.length };
    for (const id of c.eventIds) byEventId[id] = c.id;
  }
  return { byEventId, clusters: meta };
}

export interface ClusterGroup<T> {
  clusterId: string;
  label: string;
  emoji: string;
  startDate: string;
  endDate: string;
  eventCount: number;
  events: T[];
}

// Partition a window card's matched historical events into cluster groups
// (for events the AI grouped) and singles (everything else). A null map
// reproduces today's rendering exactly: no groups, all singles.
export function groupEventsByCluster<T extends { id?: string }>(
  events: T[],
  histClusters: HistClusters | null | undefined
): { clusters: ClusterGroup<T>[]; singles: T[] } {
  if (!histClusters) return { clusters: [], singles: [...events] };

  const groups = new Map<string, T[]>();
  const singles: T[] = [];
  for (const e of events) {
    const cid = e.id ? histClusters.byEventId[e.id] : undefined;
    if (cid && histClusters.clusters[cid]) {
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid)!.push(e);
    } else {
      singles.push(e);
    }
  }

  const clusters: ClusterGroup<T>[] = Array.from(groups.entries()).map(([cid, evts]) => {
    const m = histClusters.clusters[cid];
    return { clusterId: cid, label: m.label, emoji: m.emoji, startDate: m.startDate, endDate: m.endDate, eventCount: m.eventCount, events: evts };
  });
  return { clusters, singles };
}
