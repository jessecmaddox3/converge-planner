import type { EnrichedWindow } from "@/lib/analysis";
import { longDate } from "./trip-client";

export function PrivateCalendarCheck({ check }: { check?: EnrichedWindow }) {
  if (!check) return null;
  return (
    <div className="private-date-check">
      <p>{check.summary}.</p>
      {check.windowEvents.length > 0 && (
        <details>
          <summary>See your events</summary>
          <ul>
            {check.windowEvents.map((event, index) => (
              <li key={event.key || index}>
                <strong>{event.title}</strong>
                <span>
                  {longDate(event.date)}
                  {event.time ? ` · ${event.time}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {check.travelAdjacency && (
        <p className="muted small">
          Travel nearby: {check.travelAdjacency.span.label}.
        </p>
      )}
    </div>
  );
}
