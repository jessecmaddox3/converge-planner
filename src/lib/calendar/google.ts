import { isDemo } from "@/lib/runtime/config";
import { fixtureCalendars, fixtureEvents } from "@/lib/demo/calendars";
import { google } from "googleapis";
import type { CalendarSource } from "@/lib/calendar/types";
import type { GoogleEventResource } from "@/lib/calendar/normalize";

export const MAX_CALENDARS = 100;
export const MAX_EVENTS_PER_CALENDAR = 5_000;

export type GoogleFailureKind =
  | "auth"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "upstream";

export class GoogleCalendarFailure extends Error {
  constructor(
    public kind: GoogleFailureKind,
    public status?: number
  ) {
    super("Google Calendar request failed");
    this.name = "GoogleCalendarFailure";
  }
}

export interface PaginatedResult<T> {
  items: T[];
  truncated: boolean;
  pageCount: number;
}

export interface GoogleEventRange {
  timeMin: string;
  timeMax?: string;
  timeZone?: string;
}

function calendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

function numericStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    response?: { status?: unknown };
    status?: unknown;
    code?: unknown;
  };
  const value = candidate.response?.status ?? candidate.status ?? candidate.code;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function sanitizedFailure(error: unknown, signal?: AbortSignal): GoogleCalendarFailure {
  if (error instanceof GoogleCalendarFailure) return error;
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  if (signal?.aborted || name === "AbortError") {
    return new GoogleCalendarFailure("timeout");
  }
  const status = numericStatus(error);
  if (status === 401) return new GoogleCalendarFailure("auth", status);
  if (status === 403) return new GoogleCalendarFailure("forbidden", status);
  if (status === 429) return new GoogleCalendarFailure("rate_limited", status);
  return new GoogleCalendarFailure("upstream", status);
}

export async function listAllCalendars(
  accessToken: string
): Promise<PaginatedResult<CalendarSource>> {
  if (isDemo()) return fixtureCalendars(accessToken);
  const client = calendarClient(accessToken);
  const items: CalendarSource[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  let pageCount = 0;
  let truncated = false;

  try {
    while (true) {
      const response = await client.calendarList.list({
        maxResults: 250,
        pageToken,
      });
      pageCount += 1;
      for (const calendar of response.data.items || []) {
        if (!calendar.id) continue;
        if (items.length >= MAX_CALENDARS) {
          truncated = true;
          break;
        }
        items.push({
          calendarId: calendar.id,
          name: calendar.summary || "Unnamed",
          color: calendar.backgroundColor || "#4285F4",
          primary: Boolean(calendar.primary),
        });
      }
      if (truncated) break;
      const nextToken = response.data.nextPageToken || undefined;
      if (!nextToken) break;
      if (seenTokens.has(nextToken)) {
        throw new GoogleCalendarFailure("upstream");
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
    return { items, truncated, pageCount };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}

export async function listAllEvents(
  accessToken: string,
  calendarId: string,
  range: GoogleEventRange,
  signal?: AbortSignal
): Promise<PaginatedResult<GoogleEventResource>> {
  if (isDemo()) return fixtureEvents(accessToken, calendarId, range);
  const client = calendarClient(accessToken);
  const items: GoogleEventResource[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  let pageCount = 0;
  let truncated = false;

  try {
    while (true) {
      const response = await client.events.list(
        {
          calendarId,
          timeMin: range.timeMin,
          timeMax: range.timeMax,
          timeZone: range.timeZone,
          singleEvents: true,
          showDeleted: false,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
        },
        signal ? { signal } : undefined
      );
      pageCount += 1;
      for (const event of response.data.items || []) {
        if (items.length >= MAX_EVENTS_PER_CALENDAR) {
          truncated = true;
          break;
        }
        items.push(event);
      }
      if (truncated) break;
      const nextToken = response.data.nextPageToken || undefined;
      if (!nextToken) break;
      if (seenTokens.has(nextToken)) {
        throw new GoogleCalendarFailure("upstream");
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
    return { items, truncated, pageCount };
  } catch (error) {
    throw sanitizedFailure(error, signal);
  }
}
