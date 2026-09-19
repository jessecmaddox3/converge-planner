import type { AnalyzedEvent, EnrichedWindow } from "@/lib/analysis";
import { longDate } from "./trip-client";
import { optionLabel } from "./DateExplorer";

export function OptionDetails({
  window,
  selected,
  timeZone,
  onToggle,
  onOverride,
}: {
  window: EnrichedWindow;
  selected: boolean;
  timeZone: string;
  onToggle: () => void;
  onOverride: (key: string, value: AnalyzedEvent["override"]) => void;
}) {
  const events = [...window.windowEvents].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const assessment = window.assessment;
  const travel = window.travelAdjacency;
  return (
    <aside
      className="option-details panel stack"
      aria-labelledby="option-detail-title"
    >
      <div>
        <span className="eyebrow">The full picture</span>
        <h2 id="option-detail-title" tabIndex={-1}>
          {optionLabel(window)}
        </h2>
        <p className="muted small">
          {new Date(`${window.start}T12:00:00`).getFullYear()}
          {window.start.slice(0, 4) !== window.end.slice(0, 4)
            ? ` to ${window.end.slice(0, 4)}`
            : ""}{" "}
          · {timeZone.replaceAll("_", " ")}
        </p>
      </div>
      <p className={`notice ${window.fixedCount ? "warning" : ""}`}>
        {window.summary}.
      </p>
      {assessment && assessment.busyMinutes > 0 && (
        <p className="muted small">
          {Math.round(assessment.busyMinutes / 6) / 10} hours occupied
          {assessment.estimatedTime
            ? " (some durations estimated)"
            : ", with overlapping events counted once"}
          .
        </p>
      )}
      {travel && (
        <div className="travel-context">
          <strong>
            Travel{" "}
            {travel.direction === "overlapping" ? "during this stay" : "nearby"}
          </strong>
          <p>
            {travel.span.label}: {longDate(travel.span.startDate)}
            {travel.span.endDate !== travel.span.startDate
              ? ` to ${longDate(travel.span.endDate)}`
              : ""}
            .
          </p>
          <p>
            {travel.direction === "overlapping"
              ? "Overlaps this option."
              : `${travel.gapDays} clear ${travel.gapDays === 1 ? "day" : "days"} ${travel.direction === "before" ? "before departure" : "after return"}.`}
            {travel.span.confidence === "low"
              ? " Inferred from limited calendar details."
              : ""}
          </p>
        </div>
      )}
      {events.length > 0 && (
        <section aria-label="Calendar events for this option">
          <h3>Commitments to consider</h3>
          <p className="muted small" style={{ marginTop: 6 }}>
            You know what matters. Adjust any assumption below.
          </p>
          <div className="detail-events">
            {events.map((event, index) => (
              <article className="detail-event" key={event.key || index}>
                <strong>{event.title || "Untitled event"}</strong>
                <p>{eventDateTime(event, timeZone)}</p>
                {event.calendar && <p>{event.calendar}</p>}
                {event.reasoning && <p>{event.reasoning}</p>}
                {event.key && (
                  <div className="field">
                    <label
                      className="sr-only"
                      htmlFor={`override-${event.key}`}
                    >
                      How to treat {event.title}
                    </label>
                    <select
                      id={`override-${event.key}`}
                      value={event.override || ""}
                      onChange={(change) =>
                        onOverride(
                          event.key!,
                          (change.target.value as AnalyzedEvent["override"]) ||
                            undefined,
                        )
                      }
                    >
                      <option value="">Use calendar assessment</option>
                      <option value="must-attend">Must attend</option>
                      <option value="can-move">Can move</option>
                      <option value="ignore">Ignore for this trip</option>
                    </select>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <button
        className="text-button mobile-back"
        type="button"
        onClick={() =>
          (
            document.querySelector(
              ".calendar-day.focused-day",
            ) as HTMLButtonElement | null
          )?.focus()
        }
      >
        ← Back to the calendar
      </button>
      <button
        className={`button ${selected ? "secondary" : ""}`}
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
      >
        {selected ? "✓ In your shortlist" : "Add to shortlist"}
      </button>
      <p className="muted small">
        Calendar details and your adjustments are visible only to you.
      </p>
    </aside>
  );
}
function eventDateTime(event: AnalyzedEvent, timeZone: string): string {
  if (event.interval?.kind === "timed") {
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    };
    return `${new Date(event.interval.start).toLocaleString("en-US", options)} to ${new Date(event.interval.end).toLocaleString("en-US", options)}`;
  }
  return `${longDate(event.date)}${event.interval?.kind === "all-day" ? " · All day" : event.time ? ` · ${event.time}` : ""}`;
}
