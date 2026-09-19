import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { cachedJob } from "@/lib/cached-job";
import { consumeQuota } from "@/lib/rate-limit";
import { validateScanRange } from "./range";
import {
  scanCalendars,
  scanCalendarHistory,
  type CalendarScanRequest,
  type CalendarMetadata,
  type CalendarScanResponse,
} from "./scan";

export interface CachedScanRequest extends CalendarScanRequest {
  refresh?: boolean;
}
export function parseScanRequest(value: unknown): CachedScanRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "INVALID_REQUEST", "Invalid calendar scan request");
  const input = value as Partial<CachedScanRequest>;
  if (
    !Array.isArray(input.calendarIds) ||
    input.calendarIds.length < 1 ||
    input.calendarIds.length > 25 ||
    input.calendarIds.some(
      (id) => typeof id !== "string" || !id.trim() || id.length > 512,
    ) ||
    new Set(input.calendarIds).size !== input.calendarIds.length ||
    typeof input.startDate !== "string" ||
    typeof input.endDate !== "string" ||
    typeof input.timeZone !== "string" ||
    ![undefined, 0, 1, 2].includes(input.historyPeriods) ||
    (input.refresh !== undefined && typeof input.refresh !== "boolean")
  )
    throw new ApiError(400, "INVALID_REQUEST", "Invalid calendar scan request");
  validateScanRange({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
  });
  const metadata: Record<string, CalendarMetadata> = Object.create(null);
  if (
    input.calendarMetadata !== undefined &&
    (!input.calendarMetadata ||
      typeof input.calendarMetadata !== "object" ||
      Array.isArray(input.calendarMetadata))
  )
    throw new ApiError(400, "INVALID_REQUEST", "Invalid calendar metadata");
  for (const id of input.calendarIds) {
    const item = input.calendarMetadata?.[id];
    if (!item) continue;
    if (
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      item.name.length > 512 ||
      (item.color != null &&
        (typeof item.color !== "string" || item.color.length > 32)) ||
      (item.primary !== undefined && typeof item.primary !== "boolean")
    )
      throw new ApiError(400, "INVALID_REQUEST", "Invalid calendar metadata");
    metadata[id] = {
      name: item.name,
      color: item.color || null,
      primary: Boolean(item.primary),
    };
  }
  return {
    calendarIds: input.calendarIds,
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    historyPeriods: input.historyPeriods || 0,
    ...(Object.keys(metadata).length ? { calendarMetadata: metadata } : {}),
    ...(input.refresh ? { refresh: true } : {}),
  };
}
export function scanCacheKey(
  actorKey: string,
  input: CachedScanRequest,
  historyOnly = false,
): string {
  const calendars = [...input.calendarIds]
    .sort()
    .map((id) => [
      id,
      input.calendarMetadata?.[id]?.name || id,
      input.calendarMetadata?.[id]?.primary || false,
      input.calendarMetadata?.[id]?.color || null,
    ]);
  return (
    "calendar:v1:" +
    createHash("sha256")
      .update(
        JSON.stringify([
          actorKey,
          calendars,
          input.startDate,
          input.endDate,
          input.timeZone,
          input.historyPeriods || 0,
          historyOnly,
        ]),
      )
      .digest("hex")
  );
}
export async function cachedCalendarScan(
  actorKey: string,
  input: CachedScanRequest,
  getToken: () => Promise<string | null>,
  historyOnly = false,
) {
  if (historyOnly && !input.historyPeriods)
    throw new ApiError(400, "INVALID_REQUEST", "Choose a history period");
  const { refresh, ...scanInput } = input;
  return cachedJob<
    CalendarScanResponse | Pick<CalendarScanResponse, "history" | "stats">
  >(scanCacheKey(actorKey, input, historyOnly), {
    ttlSeconds: 300,
    leaseSeconds: 55,
    refresh,
    generate: async () => {
      const token = await getToken();
      if (!token)
        throw new ApiError(
          401,
          "UNAUTHORIZED",
          "Reconnect Google Calendar to continue.",
        );
      for (const quota of [
        { windowSeconds: 60, limit: 6 },
        { windowSeconds: 3600, limit: 60 },
      ]) {
        const result = await consumeQuota({
          actorKey,
          action: "calendar-scan",
          ...quota,
        });
        if (!result.allowed)
          throw new ApiError(
            429,
            "RATE_LIMITED",
            "Too many calendar checks. Please wait before refreshing.",
            result.retryAfter,
          );
      }
      return historyOnly
        ? scanCalendarHistory(scanInput, token)
        : scanCalendars(scanInput, token);
    },
    // Failed or incomplete checks should be retried, never mistaken for reusable complete data.
    cacheable: (result) =>
      ("current" in result
        ? [result.current, ...result.history]
        : result.history
      ).every(
        (period) =>
          period.coverage.status === "complete" && !period.coverage.truncated,
      ),
  });
}
