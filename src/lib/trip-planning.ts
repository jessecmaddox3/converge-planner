import { tripBounds } from "./scheduling";
import { addCalendarDays } from "./calendar/range";

export interface ExpectedPerson {
  id: string;
  name: string;
  required: boolean;
  responsePublicId?: string;
}
export interface PlanningSettings {
  revision: number;
  requiredResponseIds: string[];
  expectedPeople: ExpectedPerson[];
  invitationsClosed: boolean;
}
export interface TripTimeFields {
  timeZone?: string;
  departureTime?: string;
  returnTime?: string;
}
export function emptyPlanning(): PlanningSettings {
  return { revision: 0, requiredResponseIds: [], expectedPeople: [], invitationsClosed: false };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid(): never { throw new Error("INVALID_INPUT"); }

export function parsePlanning(value: unknown, responseIds?: string[]): PlanningSettings {
  if (!record(value)) return invalid();
  const revision = value.revision ?? 0;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) return invalid();
  const required = value.requiredResponseIds ?? [];
  const expected = value.expectedPeople ?? [];
  if (!Array.isArray(required) || required.length > 100 || !Array.isArray(expected) || expected.length > 100) return invalid();
  const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id);
  const requiredResponseIds = required.map((id) => {
    if (!validId(id) || (responseIds && !responseIds.includes(id))) return invalid();
    return id;
  });
  if (new Set(requiredResponseIds).size !== requiredResponseIds.length) return invalid();
  const expectedPeople: ExpectedPerson[] = expected.map((person) => {
    if (!record(person) || !validId(person.id) || typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 100) return invalid();
    if (person.required !== undefined && typeof person.required !== "boolean") return invalid();
    const result: ExpectedPerson = { id: person.id, name: person.name.trim(), required: person.required === true };
    if (person.responsePublicId !== undefined && person.responsePublicId !== "") {
      if (!validId(person.responsePublicId) || (responseIds && !responseIds.includes(person.responsePublicId))) return invalid();
      result.responsePublicId = person.responsePublicId;
    }
    return result;
  });
  if (new Set(expectedPeople.map((person) => person.id)).size !== expectedPeople.length) return invalid();
  const assigned = expectedPeople.flatMap((person) => person.responsePublicId ? [person.responsePublicId] : []);
  if (new Set(assigned).size !== assigned.length) return invalid();
  if (value.invitationsClosed !== undefined && typeof value.invitationsClosed !== "boolean") return invalid();
  return { revision: Number(revision), requiredResponseIds, expectedPeople, invitationsClosed: value.invitationsClosed === true };
}

export function parseTripTiming(value: unknown, starts: string[], duration: number): TripTimeFields {
  if (!record(value)) return invalid();
  if (value.timeZone === undefined && value.departureTime === undefined && value.returnTime === undefined) return {};
  if (typeof value.timeZone !== "string" || value.timeZone.length > 100) return invalid();
  const result: TripTimeFields = { timeZone: value.timeZone };
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }); } catch { return invalid(); }
  for (const field of ["departureTime", "returnTime"] as const) {
    const time = value[field];
    if (time === undefined || time === "") continue;
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return invalid();
    result[field] = time;
  }
  for (const start of starts) {
    try { tripBounds({ start, end: addCalendarDays(start, duration - 1) }, { ...result, timeZone: value.timeZone }); }
    catch { return invalid(); }
  }
  return result;
}
