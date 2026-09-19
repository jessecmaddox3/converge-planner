import {useRuntime} from "@/components/RuntimeContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { scoreCalendarEvent, type SummaryCluster } from "@/lib/analysis";
import { sampleHistoryEvents } from "@/lib/ai-inputs";
import type { HistoricalScanPeriod } from "@/lib/calendar/scan";
import { calendarJson, type UserCalendar } from "./useCalendarScan";

function historicalDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function HistoryPanel({
  range,
  calendars,
  calendarIds,
}: {
  range: { startDate: string; endDate: string; timeZone: string };
  calendars: UserCalendar[];
  calendarIds: string[];
}) {
  const {mode} = useRuntime();
  const [history, setHistory] = useState<HistoricalScanPeriod[] | null>(null);
  const [clusters, setClusters] = useState<SummaryCluster[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(40);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const events = useMemo(
    () =>
      (history || [])
        .flatMap((period) =>
          period.events.map((event) => ({
            ...scoreCalendarEvent(event),
            historyPeriod: period.yearsBack,
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [history],
  );
  const sample = useMemo(() => sampleHistoryEvents(events), [events]);
  async function load() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 65000);
    setBusy("history");
    setError("");
    try {
      const response = await calendarJson("/api/calendar-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          ...range,
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
          historyPeriods: 2,
          refresh: Boolean(history),
        }),
      });
      if (!abort.signal.aborted) {
        setHistory(response.history);
        setClusters(null);
        setLimit(40);
      }
    } catch (reason) {
      if (!abort.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load past events.",
        );
      else setError("The history check timed out. Try fewer calendars.");
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) setBusy("");
    }
  }
  async function group() {
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 30000);
    setBusy("groups");
    setError("");
    try {
      const response = await calendarJson("/api/summarize-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          events: sample.events,
          timeZone: range.timeZone,
        }),
      });
      if (!abort.signal.aborted) setClusters(response.clusters);
    } catch (reason) {
      setError(
        abort.signal.aborted
          ? "Grouping timed out. Your original events are still below."
          : reason instanceof Error
            ? reason.message
            : "Could not group past events.",
      );
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) setBusy("");
    }
  }
  return (
    <section className="history-panel panel" aria-labelledby="history-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">A little context</span>
          <h2 id="history-title">Look back at this time of year</h2>
          <p>
            Past events can help you remember recurring commitments. Check this
            year’s dates before drawing conclusions.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={Boolean(busy)}
          onClick={() => void load()}
        >
          {busy === "history"
            ? "Loading history…"
            : history
              ? "Refresh past events"
              : "Load past calendar events"}
        </button>
      </div>
      {error && (
        <p className="notice warning" role="status">
          {error}
        </p>
      )}
      {history && (
        <div className="history-content stack">
          <p className="muted small">
            {events.length} past events from {history.length}{" "}
            {history.length === 1 ? "prior year" : "prior years"}.
          </p>
          {history.some(
            (period) =>
              period.coverage.status !== "complete" ||
              period.coverage.truncated,
          ) && (
            <p className="notice warning">
              Some past calendars could not be fully loaded. These events show
              only the available history.
            </p>
          )}
          {sample.events.length >= 2 && clusters === null && (
            <div className="history-group-action">
              <div>
                <strong>Make past trips easier to recognize</strong>
                <p className="muted small">
                  {mode === 'demo' ? "Try a clearly labeled local grouping simulation. No AI provider is called." : "Optionally send event titles, dates, locations, calendars and durations to Gemini to group related activities."}
                </p>
                {sample.copy && <p className="muted small">{sample.copy}</p>}
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => void group()}
              >
                {busy === "groups"
                  ? "Grouping events…"
                  : mode === "demo" ? "Try simulated grouping" : "Group related events with AI"}
              </button>
            </div>
          )}
          {clusters && (
            <div className="history-clusters">
              {clusters.length === 0 ? (
                <p className="notice">
                  No related activities were identified. The original events are
                  below.
                </p>
              ) : (
                <>
                  <p className="muted small">
                    {clusters.length} related{" "}
                    {clusters.length === 1 ? "activity" : "activities"} found.{" "}
                    {sample.copy || "Original events remain available below."}
                  </p>
                  {clusters.map((cluster) => (
                    <article key={cluster.id}>
                      <span aria-hidden="true">{cluster.emoji}</span>
                      <div>
                        <strong>{cluster.label}</strong>
                        <p>
                          {historicalDate(cluster.startDate)}
                          {cluster.endDate !== cluster.startDate
                            ? ` to ${historicalDate(cluster.endDate)}`
                            : ""}{" "}
                          · {cluster.eventIds.length} events
                        </p>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
          )}
          {events.length > 0 && (
            <details className="original-events">
              <summary>All original events ({events.length})</summary>
              <ul>
                {events.slice(0, limit).map((event, index) => (
                  <li key={`${event.key}:${index}`}>
                    <time>{historicalDate(event.date)}</time>
                    <div>
                      <strong>{event.title}</strong>
                      <p>
                        {event.calendar}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {limit < events.length && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setLimit((value) => value + 40)}
                >
                  Show more original events ({events.length - limit} left)
                </button>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
