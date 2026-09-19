import { formatLocalDate } from "./analysis";
import { addCalendarDays } from "./calendar/range";
import {
  generateCandidateStarts,
  isLocalDate,
  type TripPreset,
} from "./trip-validation";
import { parseTripTiming } from "./trip-planning";

export const DRAFT_KEY = "converge:organizer-draft:v1";
export interface TripDraft {
  version: 1;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;
  durationPreset: TripPreset;
  notes: string;
  timeZone: string;
  departureTime: string;
  returnTime: string;
  selectedDates: string[];
  exploring: boolean;
  restDay: boolean;
}
export function initialDraft(today = formatLocalDate(new Date())): TripDraft {
  return {
    version: 1,
    name: "",
    startDate: today,
    endDate: addCalendarDays(today, 90),
    duration: 3,
    durationPreset: "weekend",
    notes: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    departureTime: "",
    returnTime: "",
    selectedDates: [],
    exploring: false,
    restDay: false,
  };
}
export function draftStarts(draft: TripDraft): string[] {
  return generateCandidateStarts({ ...draft, preset: draft.durationPreset });
}
export function updateDraft(
  draft: TripDraft,
  changes: Partial<TripDraft>,
): TripDraft {
  const next = { ...draft, ...changes };
  try {
    const allowed = new Set(draftStarts(next));
    next.selectedDates = next.selectedDates.filter((date) => allowed.has(date));
  } catch {
    next.selectedDates = [];
  }
  return next;
}
export function draftError(draft: TripDraft): string {
  if (!draft.name.trim()) return "Give your trip a name.";
  if (!isLocalDate(draft.startDate) || !isLocalDate(draft.endDate))
    return "Choose an earliest and latest date.";
  if (draft.endDate < draft.startDate)
    return "The latest date must be on or after the earliest date.";
  let starts: string[];
  try {
    starts = draftStarts(draft);
  } catch {
    return "Choose a range of up to one year and a trip length of 1 to 14 days.";
  }
  if (!starts.length)
    return "This range does not fit a full trip. Extend the latest date or choose a shorter stay.";
  try {
    parseTripTiming(draft, starts, draft.duration);
  } catch {
    return "Check the timezone and travel times. Some times repeat or do not exist when clocks change.";
  }
  return "";
}
export function serializeDraft(draft: TripDraft): string {
  const {
    version,
    name,
    startDate,
    endDate,
    duration,
    durationPreset,
    notes,
    timeZone,
    departureTime,
    returnTime,
    selectedDates,
    exploring,
    restDay,
  } = draft;
  return JSON.stringify({
    version,
    name,
    startDate,
    endDate,
    duration,
    durationPreset,
    notes,
    timeZone,
    departureTime,
    returnTime,
    selectedDates,
    exploring,
    restDay,
  });
}
export function readDraft(raw: string | null): TripDraft | null {
  try {
    const value = JSON.parse(raw || "null");
    if (
      !value ||
      value.version !== 1 ||
      typeof value.name !== "string" ||
      value.name.length > 200 ||
      typeof value.notes !== "string" ||
      value.notes.length > 2000 ||
      typeof value.timeZone !== "string" ||
      typeof value.departureTime !== "string" ||
      typeof value.returnTime !== "string" ||
      !Array.isArray(value.selectedDates) ||
      value.selectedDates.length > 100 ||
      !value.selectedDates.every(isLocalDate) ||
      typeof value.exploring !== "boolean" ||
      typeof value.restDay !== "boolean"
    )
      return null;
    const clean = JSON.parse(serializeDraft(value)) as TripDraft;
    const starts = draftStarts(clean);
    parseTripTiming(clean, starts, clean.duration);
    return updateDraft(clean, {});
  } catch {
    return null;
  }
}
