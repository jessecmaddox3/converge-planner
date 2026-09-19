import {useRuntime} from "@/components/RuntimeContext";
import type { useCalendarScan } from "./useCalendarScan";
import CalendarCoverage from "./CalendarCoverage";
export function CalendarConnection({
  calendar,
  onConnect,
  onReconnect,
  privateMode = false,
}: {
  calendar: ReturnType<typeof useCalendarScan>;
  onConnect: () => void;
  onReconnect: () => void;
  privateMode?: boolean;
}) {
  const {mode}=useRuntime();
  return (
    <section className="calendar-connection" aria-label="Your calendar">
      <div className="calendar-connection-heading">
        <div>
          <strong>
            {privateMode
              ? "Check your own calendar"
              : "Add your calendar to the picture"}
          </strong>
          <p className="muted small">
            {privateMode
              ? "See your conflicts here. Your events stay private, and your answers are always your choice."
              : "Find conflicts in your calendars. You decide which commitments can move."}
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={calendar.busy}
          onClick={
            calendar.needsReconnect
              ? onReconnect
              : calendar.calendars.length
                ? () => void calendar.scan(Boolean(calendar.result))
                : onConnect
          }
        >
          {calendar.busy
            ? "Checking…"
            : calendar.needsReconnect
              ? (mode === "demo" ? "Retry fictional calendars" : "Reconnect Google Calendar")
              : calendar.result
                ? "Refresh calendar"
                : calendar.calendars.length
                  ? "Check selected calendars"
                  : (mode === "demo" ? "Try fictional calendars" : "Connect Google Calendar")}
        </button>
      </div>
      {calendar.calendars.length > 0 && (
        <details className="calendar-selection" open={!calendar.result}>
          <summary>
            {calendar.calendarIds.length}{" "}
            {calendar.calendarIds.length === 1 ? "calendar" : "calendars"}{" "}
            selected
            {calendar.checkedAt
              ? ` · Checked ${new Date(calendar.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </summary>
          <div className="calendar-checkboxes">
            {calendar.calendars.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={calendar.calendarIds.includes(item.id)}
                  disabled={
                    calendar.busy ||
                    (!calendar.calendarIds.includes(item.id) &&
                      calendar.calendarIds.length >= 25)
                  }
                  onChange={(event) =>
                    calendar.setCalendarIds((ids) =>
                      event.target.checked
                        ? [...ids, item.id]
                        : ids.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.name}
                {item.primary ? " (primary)" : ""}
              </label>
            ))}
          </div>
        </details>
      )}
      {calendar.error && (
        <p className="notice error" role="alert">
          {calendar.error}
        </p>
      )}
      {calendar.result && (
        <CalendarCoverage
          coverage={calendar.result.current.coverage}
          eventCount={calendar.result.current.events.length}
          onRetry={() => void calendar.scan(true)}
        />
      )}
    </section>
  );
}
