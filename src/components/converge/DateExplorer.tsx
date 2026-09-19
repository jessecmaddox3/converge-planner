import { useEffect, useMemo, useState } from "react";
import type { EnrichedWindow } from "@/lib/analysis";
import { groupDateFamilies } from "@/lib/scheduling";
import { addCalendarDays } from "@/lib/calendar/range";
import { dateRangeLabel, longDate } from "./trip-client";

export function optionLabel(window: EnrichedWindow): string {
  return dateRangeLabel(
    window.start,
    Math.round((Date.parse(window.end) - Date.parse(window.start)) / 86400000) +
      1,
  );
}
export function statusLabel(window: EnrichedWindow): string {
  if (window.assessment?.confidence === "not-checked") return "Not checked";
  const label = window.fixedCount
    ? `${window.fixedCount} fixed`
    : window.eventCount
      ? `${window.eventCount} to review`
      : "Clear";
  return window.assessment?.confidence === "incomplete"
    ? window.eventCount
      ? `${label} · partial calendar`
      : "Partial calendar"
    : label;
}
function shiftedMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
export function DateExplorer({
  windows,
  selected,
  focused,
  onFocus,
  onToggle,
}: {
  windows: EnrichedWindow[];
  selected: string[];
  focused: string;
  onFocus: (date: string) => void;
  onToggle: (date: string) => void;
}) {
  const chronological = useMemo(
    () => [...windows].sort((a, b) => a.start.localeCompare(b.start)),
    [windows],
  );
  const families = useMemo(() => groupDateFamilies(windows), [windows]);
  const [limit, setLimit] = useState(5);
  const [month, setMonth] = useState(
    (focused || chronological[0]?.start || "").slice(0, 7),
  );
  useEffect(() => {
    if (focused) setMonth(focused.slice(0, 7));
  }, [focused]);
  useEffect(() => {
    setLimit(5);
  }, [windows.length]);
  if (!windows.length)
    return (
      <p className="notice">
        There are no complete options in this range. Adjust your dates or trip
        length.
      </p>
    );
  const firstMonth = chronological[0].start.slice(0, 7);
  const lastMonth = chronological[chronological.length - 1].end.slice(0, 7);
  const shownMonth =
    month >= firstMonth && month <= lastMonth ? month : firstMonth;
  const first = `${shownMonth}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days =
    new Date(`${shiftedMonth(shownMonth, 1)}-01T12:00:00Z`).getTime() -
    Date.parse(first);
  const count = Math.round(days / 86400000 - 0.5);
  const focusedWindow = windows.find((window) => window.start === focused);
  const focus = (date: string) => {
    onFocus(date);
    setMonth(date.slice(0, 7));
  };
  const option = (window: EnrichedWindow, alternative = false) => (
    <div
      className={`date-list-row${focused === window.start ? " is-focused" : ""}${alternative ? " alternative" : ""}`}
      key={window.start}
    >
      <button
        type="button"
        className="inspect-option"
        aria-label={`Inspect ${optionLabel(window)}`}
        aria-pressed={focused === window.start}
        onClick={() => focus(window.start)}
      >
        <strong>{optionLabel(window)}</strong>
        <span>
          <i className={`status-dot ${window.aiSeverity}`} />
          {statusLabel(window)}
          {window.travelAdjacency && (
            <span className="nearby-label"> · Travel nearby</span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="shortlist-toggle"
        aria-label={`${selected.includes(window.start) ? "Remove" : "Add"} ${optionLabel(window)} ${selected.includes(window.start) ? "from" : "to"} shortlist`}
        aria-pressed={selected.includes(window.start)}
        onClick={() => onToggle(window.start)}
      >
        {selected.includes(window.start) ? "✓" : "+"}
      </button>
    </div>
  );
  return (
    <div className="date-browser stack">
      <section
        className="month-panel panel"
        aria-label="Browse candidate start dates"
      >
        <div className="month-nav">
          <h2>
            {new Date(`${first}T12:00:00Z`).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </h2>
          <div>
            <button
              type="button"
              aria-label="Previous month"
              disabled={shownMonth <= firstMonth}
              onClick={() => setMonth(shiftedMonth(shownMonth, -1))}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Next month"
              disabled={shownMonth >= lastMonth}
              onClick={() => setMonth(shiftedMonth(shownMonth, 1))}
            >
              →
            </button>
          </div>
        </div>
        <p className="muted small" style={{ margin: "8px 0 18px" }}>
          Choose a start date to inspect the full stay.
        </p>
        <div
          className="month-grid"
          role="group"
          aria-label="Candidate start dates"
        >
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
            <span
              className="weekday"
              key={`weekday-${index}`}
              aria-hidden="true"
            >
              {day}
            </span>
          ))}
          {Array.from({ length: offset }, (_, index) => (
            <span key={`blank-${index}`} />
          ))}
          {Array.from({ length: count }, (_, index) => {
            const date = addCalendarDays(first, index);
            const candidate = windows.find((window) => window.start === date);
            const inFocus =
              focusedWindow &&
              date >= focusedWindow.start &&
              date <= focusedWindow.end;
            return (
              <button
                type="button"
                key={date}
                disabled={!candidate}
                className={`calendar-day${inFocus ? " in-stay" : ""}${date === focused ? " focused-day" : ""}${selected.includes(date) ? " shortlisted-day" : ""}`}
                aria-label={`${longDate(date)}${candidate ? `, ${statusLabel(candidate)}` : ", no option starts here"}${selected.includes(date) ? ", shortlisted" : ""}`}
                aria-pressed={date === focused}
                onClick={() => focus(date)}
              >
                <span>{index + 1}</span>
                {candidate && (
                  <i className={`status-dot ${candidate.aiSeverity}`} />
                )}
                {selected.includes(date) && <b aria-hidden="true">✓</b>}
              </button>
            );
          })}
        </div>
        <div className="calendar-legend">
          <span>
            <i className="status-dot clear" />
            Clear
          </span>
          <span>
            <i className="status-dot moderate" />
            Review
          </span>
          <span>
            <i className="status-dot unknown" />
            Not checked
          </span>
          <span>✓ Shortlisted</span>
        </div>
      </section>
      <section aria-labelledby="date-groups-title">
        <div className="section-heading">
          <div>
            <h2 id="date-groups-title">
              {windows[0].assessment?.confidence === "not-checked"
                ? "Explore your options"
                : "Best calendar fits"}
            </h2>
            <p>
              {windows.length} exact options
              {families.length < windows.length
                ? ` in ${families.length} date groups`
                : ""}
              . Similar stays are grouped together.
            </p>
          </div>
        </div>
        <div className="date-families">
          {families.slice(0, limit).map((family) => (
            <article className="date-family" key={family.id}>
              {option(family.representative)}
              {family.variants.length > 1 && (
                <details className="date-variants">
                  <summary>
                    {family.variants.length - 1} nearby{" "}
                    {family.variants.length === 2
                      ? "alternative"
                      : "alternatives"}
                  </summary>
                  {family.variants
                    .filter(
                      (variant) =>
                        variant.start !== family.representative.start,
                    )
                    .map((variant) => option(variant, true))}
                </details>
              )}
            </article>
          ))}
        </div>
        {limit < families.length && (
          <button
            className="button secondary more-options"
            type="button"
            onClick={() => setLimit((value) => value + 5)}
          >
            Show more date groups ({families.length - limit} left)
          </button>
        )}
      </section>
    </div>
  );
}
