import type { CalendarEvent, LocalDate } from "@/lib/calendar/types";

export type AwaySource = "flight-chain" | "multi-day" | "out-of-office";
export type AwayConfidence = "high" | "low";

export interface AwaySpan {
  startDate: LocalDate; // inclusive
  endDate: LocalDate; // inclusive
  label: string;
  source: AwaySource;
  confidence: AwayConfidence;
}

export type TravelSeverity = "overlapping" | "severe" | "high" | "moderate" | "low";

export type TravelDirection = "before" | "after" | "overlapping";

export interface TravelAdjacency {
  severity: TravelSeverity;
  direction: TravelDirection;

  gapDays: number;
  span: AwaySpan;
}

const OPEN_CHAIN_DWELL_DAYS = 3;

/** Calendar-day arithmetic accepts already validated civil dates and uses UTC noon to avoid host-timezone transitions. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const fromMs = new Date(from + "T12:00:00Z").getTime();
  const toMs = new Date(to + "T12:00:00Z").getTime();
  return Math.round((toMs - fromMs) / 86400000);
}

const AIRPORT_LOCATION_RE = /^(.+?)\s+([A-Z]{3})$/;

const AIRPORT_QUALIFIER_RE = /\b(intl|international|airport|regional|municipal)\b/gi;

function airportCityKey(city: string): string {
  return city
    .replace(AIRPORT_QUALIFIER_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Learn city/code aliases from structured departure locations; no external airport database is required. */
export function buildAirportAliases(flights: CalendarEvent[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const event of flights) {
    const match = AIRPORT_LOCATION_RE.exec((event.location || "").trim());
    if (!match) continue;
    aliases.set(airportCityKey(match[1]), match[2]);
  }
  return aliases;
}

/** Codes and normalized city strings are separate identities. This does not infer where a person lives. */
export function resolveAirport(
  reference: string,
  aliases: Map<string, string>
): string | null {
  const trimmed = (reference || "").trim();
  if (!trimmed) return null;
  const locationMatch = AIRPORT_LOCATION_RE.exec(trimmed);
  if (locationMatch) return locationMatch[2];
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  const key = airportCityKey(trimmed);
  return aliases.get(key) || key || trimmed.toLowerCase();
}

const FLIGHT_TITLE_RE = /\bflight\b/i;
const ONE_DAY_MINUTES = 24 * 60;

/** Transparent timed flights remain travel signals even when they do not block the calendar. */
export function isFlightLike(event: CalendarEvent): boolean {
  if (!event || !FLIGHT_TITLE_RE.test(event.title || "")) return false;
  if (event.interval.kind !== "timed") return false;
  const minutes = event.durationMinutes;
  return minutes === null || minutes < ONE_DAY_MINUTES;
}

/** Case-sensitive code matching prevents ordinary three-letter words after "to" from replacing a destination. */
export function flightDestination(title: string): string | null {
  const codeMatches = Array.from((title || "").matchAll(/\bto\s+([A-Z]{3})\b/g));
  if (codeMatches.length) return codeMatches[codeMatches.length - 1][1];
  const cityMatch = /\bflight\s+to\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]*?)\s*(?:\(|$)/i.exec(title || "");
  return cityMatch ? cityMatch[1].trim() : null;
}

function flightSortKey(event: CalendarEvent): number {
  const raw =
    event.interval.kind === "timed" ? event.interval.start : event.interval.startDate;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface JourneyLeg {
  event: CalendarEvent;
  origin: string | null;
  destination: string;
  rawDestination: string;
  firstDate: LocalDate;
  lastDate: LocalDate;
}

/** Join chronological connected legs with bounded dwell. Close at a return to the initial origin. Long gaps are insufficient evidence to join; a lone leg remains a low-confidence travel day. No airport is classified as home. The longest dwell supplies the label. */
export function chainJourneys(
  flights: CalendarEvent[],
  aliases: Map<string, string>,
  maxDwellDays = 7
): AwaySpan[] {
  const legs: JourneyLeg[] = [];
  for (const event of flights) {
    const rawDestination = flightDestination(event.title);
    if (!rawDestination) continue;
    const destination = resolveAirport(rawDestination, aliases);
    if (!destination) continue;
    const dates = event.occupiedDates || [];
    if (!dates.length) continue;
    legs.push({
      event,
      origin: resolveAirport(event.location || "", aliases),
      destination,
      rawDestination,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
    });
  }
  if (!legs.length) return [];

  legs.sort((a, b) => flightSortKey(a.event) - flightSortKey(b.event));

  const spans: AwaySpan[] = [];
  let index = 0;
  while (index < legs.length) {
    const chain = [legs[index]];
    let ahead = index + 1;
    while (ahead < legs.length) {
      const next = legs[ahead];
      const previous = chain[chain.length - 1];
      const dwell = daysBetween(previous.lastDate, next.firstDate);

      const closesRoundTrip =
        chain[0].origin !== null && next.destination === chain[0].origin;
      const cap = closesRoundTrip ? maxDwellDays : OPEN_CHAIN_DWELL_DAYS;
      if (next.origin !== previous.destination || dwell < 0 || dwell > cap) break;
      chain.push(next);
      ahead += 1;

      if (next.destination === chain[0].origin) break;
    }

    const first = chain[0];
    const last = chain[chain.length - 1];

    let label = chain.length === 1 ? "Travel day" : first.rawDestination;
    if (chain.length > 1) {
      let longestDwell = -1;
      for (let position = 0; position < chain.length; position += 1) {
        const leg = chain[position];
        const next = chain[position + 1];
        const dwell = next ? daysBetween(leg.lastDate, next.firstDate) : 0;
        if (dwell > longestDwell) {
          longestDwell = dwell;
          label = leg.rawDestination;
        }
      }
    }

    spans.push({
      startDate: first.firstDate,
      endDate: last.lastDate,
      label: chain.length === 1 ? label : "Away (" + label + ")",
      source: "flight-chain",
      confidence:
        first.origin !== null && first.origin === last.destination ? "high" : "low",
    });

    index = ahead;
  }

  return spans;
}

const AWAY_KEYWORD_RE = /\b(vacation|out of town|pto|beach week|road trip)\b/i;

/** Only primary-calendar out-of-office events or all-day multiday travel keywords qualify. A single out-of-office day is low confidence; shared-calendar labels do not establish the viewer is away. */
export function fallbackSpans(events: CalendarEvent[]): AwaySpan[] {
  const spans: AwaySpan[] = [];
  for (const event of events) {
    const dates = event.occupiedDates || [];
    if (!dates.length) continue;

    const ownCalendar = (event.sources || []).some((source) => source.primary);
    if (!ownCalendar) continue;

    const outOfOffice = event.eventType === "outOfOffice";
    const keywordSpan =
      dates.length >= 2 &&
      event.interval.kind === "all-day" &&
      AWAY_KEYWORD_RE.test(event.title || "");
    if (!outOfOffice && !keywordSpan) continue;

    spans.push({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      label: event.title || "Away",
      source: outOfOffice ? "out-of-office" : "multi-day",
      confidence: outOfOffice && dates.length < 2 ? "low" : "high",
    });
  }
  return spans;
}

const SEVERITY_RANK: TravelSeverity[] = [
  "low",
  "moderate",
  "high",
  "severe",
  "overlapping",
];

function severityForGap(gapDays: number): TravelSeverity | null {
  if (gapDays <= 0) return "severe";
  if (gapDays === 1) return "high";
  if (gapDays <= 3) return "moderate";
  if (gapDays <= 6) return "low";
  return null;
}

function spanLength(span: AwaySpan): number {
  return daysBetween(span.startDate, span.endDate) + 1;
}

/** Merge overlapping or consecutive spans. Contained fragments preserve the containing confidence; a low-confidence extension lowers it. The longer contributor supplies the label. */
export function mergeSpans(spans: AwaySpan[]): AwaySpan[] {
  const sorted = spans
    .slice()
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)
    );

  const merged: AwaySpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && daysBetween(previous.endDate, span.startDate) <= 1) {
      const longer = spanLength(span) > spanLength(previous) ? span : previous;
      const previousContains =
        previous.startDate <= span.startDate && previous.endDate >= span.endDate;
      const spanContains =
        span.startDate <= previous.startDate && span.endDate >= previous.endDate;

      const confidence = previousContains
        ? previous.confidence
        : spanContains
          ? span.confidence
          : previous.confidence === "low" || span.confidence === "low"
            ? "low"
            : "high";
      merged[merged.length - 1] = {
        startDate: previous.startDate,
        endDate: previous.endDate > span.endDate ? previous.endDate : span.endDate,
        label: longer.label,
        source: longer.source,
        confidence,
      };
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/** Count clear days between inclusive spans; overlap takes priority. Break comparable ties by direction, distance and confidence. Complete label ties retain input order. */
export function travelAdjacency(
  window: { start: LocalDate; end: LocalDate },
  spans: AwaySpan[]
): TravelAdjacency | null {
  if (!Array.isArray(spans) || spans.length === 0) return null;

  let best: TravelAdjacency | null = null;

  for (const span of spans) {
    let candidate: TravelAdjacency;

    if (span.startDate <= window.end && span.endDate >= window.start) {
      candidate = { severity: "overlapping", direction: "overlapping", gapDays: 0, span };
    } else if (span.endDate < window.start) {
      const gapDays = daysBetween(span.endDate, window.start) - 1;
      const severity = severityForGap(gapDays);
      if (!severity) continue;
      candidate = { severity, direction: "before", gapDays, span };
    } else {
      const gapDays = daysBetween(window.end, span.startDate) - 1;
      const severity = severityForGap(gapDays);
      if (!severity) continue;
      candidate = { severity, direction: "after", gapDays, span };
    }

    if (!best) {
      best = candidate;
      continue;
    }

    const candidateRank = SEVERITY_RANK.indexOf(candidate.severity);
    const bestRank = SEVERITY_RANK.indexOf(best.severity);
    if (candidateRank > bestRank) {
      best = candidate;
      continue;
    }
    if (candidateRank < bestRank) continue;

    if (candidate.direction === "before" && best.direction === "after") {
      best = candidate;
      continue;
    }
    if (candidate.direction !== best.direction) continue;
    if (candidate.gapDays < best.gapDays) {
      best = candidate;
      continue;
    }
    if (
      candidate.gapDays === best.gapDays &&
      candidate.span.confidence === "high" &&
      best.span.confidence === "low"
    ) {
      best = candidate;
    }
  }

  return best;
}

/** Combine flight chains and explicit all-day evidence, ignoring canceled events. Include transparent flights independently of meeting conflicts. */
export function detectAwaySpans(events: CalendarEvent[]): AwaySpan[] {
  if (!Array.isArray(events) || events.length === 0) return [];

  const usable = events.filter((event) => event && event.status !== "cancelled");
  const flights = usable.filter(isFlightLike);
  const aliases = buildAirportAliases(flights);

  return mergeSpans(chainJourneys(flights, aliases).concat(fallbackSpans(usable)));
}
