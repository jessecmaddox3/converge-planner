import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {identityFetch} from "@/components/identity-fetch";
import { addCalendarDays } from "@/lib/calendar/range";
import type { CalendarScanResponse } from "@/lib/calendar/scan";
import { apiErrorMessage } from "./trip-client";

export interface UserCalendar {
  id: string;
  name: string;
  color?: string;
  primary?: boolean;
}
export function paddedRange(startDate: string, endDate: string) {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1;
  const budget = Math.max(0, 366 - days);
  return {
    startDate: addCalendarDays(startDate, -Math.min(7, Math.floor(budget / 2))),
    endDate: addCalendarDays(endDate, Math.min(7, Math.ceil(budget / 2))),
  };
}
export async function calendarJson(url: string, init?: RequestInit) {
  const isCalendar = url.startsWith("/api/calendar");
  const response = await identityFetch(url, init);
  const payload = await response.json().catch(() => ({}));
  // Failed scans still contain useful, explicit coverage for the viewer.
  if (
    !response.ok &&
    !payload.current?.coverage &&
    !Array.isArray(payload.history)
  )
    throw Object.assign(
      new Error(
        response.status === 401
          ? isCalendar
            ? "Your Google connection expired. Reconnect to check your calendar."
            : "Sign in again to continue. Your date choices are saved."
          : response.status >= 500
            ? isCalendar
              ? "Calendar service is temporarily unavailable. Try again shortly. Your date choices are saved."
              : "This service is temporarily unavailable. Try again shortly. Your date choices are saved."
            : apiErrorMessage(
                payload,
                `Could not load calendar (HTTP ${response.status}). Try again.`,
              ),
      ),
      { status: response.status },
    );
  return payload;
}
export function useCalendarScan(
  range: { startDate: string; endDate: string; timeZone: string },
  enabled: boolean,
  accountKey = "account",
) {
  const [calendars, setCalendars] = useState<UserCalendar[]>([]);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<{
    key: string;
    result: CalendarScanResponse;
    at: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const identity = enabled ? accountKey : "";
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const key = JSON.stringify([
    identity,
    range.startDate,
    range.endDate,
    range.timeZone,
    [...calendarIds].sort(),
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setCalendars([]);
    setCalendarIds([]);
    setLoaded(null);
    setError("");
    setNeedsReconnect(false);
    setBusy(false);
  }, [identity]);
  const connect = useCallback(async () => {
    if (!identity) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20000);
    setBusy(true);
    setError("");
    setNeedsReconnect(false);
    try {
      const list: UserCalendar[] = await calendarJson("/api/calendars", {
        signal: abort.signal,
      });
      if (abort.signal.aborted || activeIdentity.current !== identity) return;
      setCalendars(list);
      setCalendarIds(
        list
          .filter((calendar) => calendar.primary)
          .map((calendar) => calendar.id)
          .slice(0, 25)
          .concat(
            list.some((calendar) => calendar.primary) || !list.length
              ? []
              : [list[0].id],
          ),
      );
      if (!list.length)
        setError(
          "No calendars were found in this Google account. You can keep choosing dates manually.",
        );
    } catch (reason) {
      if (controller.current !== abort || activeIdentity.current !== identity)
        return;
      setNeedsReconnect((reason as { status?: number })?.status === 401);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load your calendars.",
      );
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) setBusy(false);
    }
  }, [identity]);
  const scan = useCallback(
    async (refresh = false) => {
      if (!enabled || !calendarIds.length) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const timeout = setTimeout(() => abort.abort(), 65000);
      setBusy(true);
      setError("");
      setNeedsReconnect(false);
      try {
        const result = await calendarJson("/api/calendar-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({
            ...paddedRange(range.startDate, range.endDate),
            timeZone: range.timeZone,
            calendarIds,
            calendarMetadata: Object.fromEntries(
              calendars.map((calendar) => [
                calendar.id,
                {
                  name: calendar.name,
                  primary: calendar.primary,
                  color: calendar.color,
                },
              ]),
            ),
            historyPeriods: 0,
            refresh,
          }),
        });
        if (!abort.signal.aborted && currentKey.current === key) {
          setLoaded({ key, result, at: Date.now() });
          setNeedsReconnect(
            result.current.coverage.failedCalendars.some(
              (failure: { reason: string }) => failure.reason === "auth",
            ),
          );
        }
      } catch (reason) {
        if (controller.current === abort)
          setNeedsReconnect((reason as { status?: number })?.status === 401);
        if (controller.current === abort)
          setError(
            abort.signal.aborted
              ? "Calendar check timed out. Try fewer calendars or a shorter range."
              : reason instanceof Error
                ? reason.message
                : "Could not check calendars.",
          );
      } finally {
        clearTimeout(timeout);
        if (controller.current === abort) setBusy(false);
      }
    },
    [
      enabled,
      calendarIds,
      calendars,
      range.startDate,
      range.endDate,
      range.timeZone,
      key,
    ],
  );
  return useMemo(
    () => ({
      calendars,
      calendarIds,
      setCalendarIds,
      busy,
      error,
      needsReconnect,
      connect,
      scan,
      result: enabled && loaded?.key === key ? loaded.result : null,
      checkedAt: loaded?.key === key ? loaded.at : null,
    }),
    [
      calendars,
      calendarIds,
      busy,
      error,
      needsReconnect,
      connect,
      scan,
      loaded,
      key,
      enabled,
    ],
  );
}
