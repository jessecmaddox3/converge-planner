import { isDateAnswer, type DateAnswer, type VersionedAnswers } from "./availability";
import { parseTripTiming, type TripTimeFields } from "./trip-planning";
export type TripPreset = "day" | "weekend" | "week" | "custom";
export type DatePreference = "available" | "preferred";

export interface CreateTripInput extends TripTimeFields {
  name: string;
  startDate: string;
  endDate: string;
  duration: number;
  durationPreset: TripPreset;
  notes: string;
  selectedDates: string[];
}

export interface AvailabilityInput extends VersionedAnswers {
  name: string;
  selectedDates: string[];
  preferences: Record<string, DatePreference>;
  conflictCount: number;
  email?: string;
}

type CandidateRange = {
  startDate: string;
  endDate: string;
  preset: TripPreset;
  duration: number;
};

type AvailabilityTrip = {
  selectedDates: string[];
  confirmedDate: string | null;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRESETS: TripPreset[] = ["day", "weekend", "week", "custom"];

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localNoon(value: string): Date {
  const [, yearText, monthText, dayText] = DATE_RE.exec(value)!;
  const year = Number(yearText);
  const date = new Date(year, Number(monthText) - 1, Number(dayText), 12, 0, 0, 0);
  if (year >= 0 && year <= 99) date.setFullYear(year);
  return date;
}

function formatLocalDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function inclusiveDayCount(start: Date, end: Date): number {
  const cursor = new Date(start);
  let count = 1;
  while (cursor < end && count <= 367) {
    cursor.setDate(cursor.getDate() + 1);
    count++;
  }
  return count;
}

function parsePreset(value: unknown): TripPreset {
  if (typeof value !== "string" || !PRESETS.includes(value as TripPreset)) {
    return fail("INVALID_PRESET");
  }
  return value as TripPreset;
}

function validateDuration(preset: TripPreset, value: unknown): number {
  if (!Number.isInteger(value)) return fail("INVALID_DURATION");
  const duration = value as number;
  if (
    (preset === "day" && duration !== 1) ||
    (preset === "weekend" && duration !== 3) ||
    (preset === "week" && duration !== 7) ||
    (preset === "custom" && (duration < 1 || duration > 14))
  ) {
    return fail("INVALID_DURATION");
  }
  return duration;
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  if (year < 1) return false;
  const date = localNoon(value);
  return formatLocalDate(date) === value;
}

export function generateCandidateStarts(input: CandidateRange): string[] {
  if (!isLocalDate(input.startDate) || !isLocalDate(input.endDate)) {
    return fail("INVALID_DATE");
  }
  const preset = parsePreset(input.preset);
  const duration = validateDuration(preset, input.duration);
  const start = localNoon(input.startDate);
  const end = localNoon(input.endDate);
  if (start > end) return fail("DATE_RANGE_REVERSED");
  if (inclusiveDayCount(start, end) > 366) return fail("RANGE_TOO_LARGE");

  const candidates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const correctWeekday =
      preset === "day" ||
      preset === "custom" ||
      (preset === "weekend" && cursor.getDay() === 5) ||
      (preset === "week" && cursor.getDay() === 1);
    if (correctWeekday && addDays(cursor, duration - 1) <= end) {
      candidates.push(formatLocalDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return candidates;
}

export function parseCreateTrip(value: unknown): CreateTripInput {
  if (!isRecord(value)) return fail("INVALID_INPUT");

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 200) return fail("INVALID_NAME");

  if (!isLocalDate(value.startDate) || !isLocalDate(value.endDate)) {
    return fail("INVALID_DATE");
  }
  const start = localNoon(value.startDate);
  const end = localNoon(value.endDate);
  if (start > end) return fail("DATE_RANGE_REVERSED");
  if (inclusiveDayCount(start, end) > 366) return fail("RANGE_TOO_LARGE");

  const durationPreset = parsePreset(value.durationPreset);
  const duration = validateDuration(durationPreset, value.duration);

  const notes = value.notes === undefined ? "" : value.notes;
  if (typeof notes !== "string" || notes.length > 2000) return fail("INVALID_NOTES");

  if (!Array.isArray(value.selectedDates) || value.selectedDates.length < 1 || value.selectedDates.length > 100) {
    return fail("INVALID_CANDIDATE_COUNT");
  }
  const selectedDates = value.selectedDates.map((date) => {
    if (!isLocalDate(date)) return fail("INVALID_DATE");
    return date;
  });
  if (new Set(selectedDates).size !== selectedDates.length) return fail("DUPLICATE_CANDIDATE");

  const allowed = new Set(generateCandidateStarts({
    startDate: value.startDate,
    endDate: value.endDate,
    preset: durationPreset,
    duration,
  }));
  if (selectedDates.some((date) => !allowed.has(date))) return fail("INVALID_CANDIDATE");

  return {
    ...parseTripTiming(value, selectedDates, duration),
    name,
    startDate: value.startDate,
    endDate: value.endDate,
    duration,
    durationPreset,
    notes,
    selectedDates,
  };
}

export function parseAvailability(value: unknown, trip: AvailabilityTrip): AvailabilityInput {
  if (trip.confirmedDate !== null) return fail("TRIP_CONFIRMED");
  if (!isRecord(value)) return fail("INVALID_INPUT");

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 100) return fail("INVALID_NAME");

  let answers: Record<string, DateAnswer> | undefined;
  if (value.answerVersion !== undefined || value.answers !== undefined) {
    if (value.answerVersion !== 2 || !isRecord(value.answers)) return fail("INVALID_INPUT");
    answers = {};
    for (const [date, answer] of Object.entries(value.answers)) {
      if (!trip.selectedDates.includes(date)) return fail("DATE_NOT_PROPOSED");
      if (!isDateAnswer(answer)) return fail("INVALID_INPUT");
      answers[date] = answer;
    }
  }

  const rawSelectedDates = answers ? Object.keys(answers).filter((date) => answers![date] === "available") : value.selectedDates;
  if (!Array.isArray(rawSelectedDates)) return fail("INVALID_SELECTED_DATES");
  const selectedDates = rawSelectedDates.map((date) => {
    if (!isLocalDate(date)) return fail("INVALID_DATE");
    return date;
  });
  if (new Set(selectedDates).size !== selectedDates.length) return fail("DUPLICATE_DATE");

  const proposed = new Set(trip.selectedDates);
  if (selectedDates.some((date) => !proposed.has(date))) return fail("DATE_NOT_PROPOSED");

  const rawPreferences = value.preferences === undefined ? {} : value.preferences;
  if (!isRecord(rawPreferences)) return fail("INVALID_PREFERENCE");
  const selected = new Set(selectedDates);
  const preferences: Record<string, DatePreference> = {};
  for (const [date, preference] of Object.entries(rawPreferences)) {
    if (!selected.has(date)) return fail("PREFERENCE_DATE_NOT_SELECTED");
    if (preference !== "available" && preference !== "preferred") return fail("INVALID_PREFERENCE");
    preferences[date] = preference;
  }

  const conflictCount = value.conflictCount === undefined ? 0 : value.conflictCount;
  if (!Number.isInteger(conflictCount) || (conflictCount as number) < 0 || (conflictCount as number) > 1000) {
    return fail("INVALID_CONFLICT_COUNT");
  }

  // Email is optional contact data, not identity: absent, empty, or
  // whitespace-only means "no email" and is valid, exactly as before this
  // field existed. When present it must look like an address and stay
  // within the same 200-character ceiling store.ts already enforces on
  // account emails (see accountActorFromSession's `.slice(0, 200)`). A
  // malformed address reuses INVALID_INPUT, the same "bad input" shape this
  // validator already throws for a non-record body, so the route maps it to
  // its existing 422 rather than an unmapped 500.
  const rawEmail = value.email;
  let email: string | undefined;
  if (rawEmail !== undefined && rawEmail !== null) {
    if (typeof rawEmail !== "string") return fail("INVALID_INPUT");
    const trimmedEmail = rawEmail.trim();
    if (trimmedEmail) {
      if (trimmedEmail.length > 200 || !EMAIL_RE.test(trimmedEmail)) {
        return fail("INVALID_INPUT");
      }
      email = trimmedEmail;
    }
  }

  const result: AvailabilityInput = {
    name,
    selectedDates,
    preferences,
    conflictCount: conflictCount as number,
  };
  if (email) result.email = email;
  if (answers) { result.answerVersion = 2; result.answers = answers; }
  return result;
}
