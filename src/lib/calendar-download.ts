import { addCalendarDays } from "./calendar/range";
import { tripBounds } from "./scheduling";
import type { PublicTrip } from "./store";

type CalendarTrip = Pick<
  PublicTrip,
  | "id"
  | "name"
  | "notes"
  | "duration"
  | "confirmedDate"
  | "confirmedAt"
  | "confirmationVersion"
  | "timeZone"
  | "departureTime"
  | "returnTime"
  | "calendarNamespace"
>;
function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldLine(value: string): string {
  const encoder = new TextEncoder();
  let line = "",
    bytes = 0;
  const lines: string[] = [];
  for (const character of Array.from(value)) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += character;
    bytes += size;
  }
  lines.push(line);
  return lines.join("\r\n");
}
function stamp(value: string | number) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
export function buildCalendarFile(trip: CalendarTrip): string {
  if (!trip.confirmedDate) throw new Error("Choose a confirmed date first");
  const end = addCalendarDays(trip.confirmedDate, trip.duration - 1);
  const timing = trip.departureTime || trip.returnTime;
  const bounds = timing
    ? tripBounds(
        { start: trip.confirmedDate, end },
        { ...trip, timeZone: trip.timeZone || "UTC" },
      )
    : null;
  const dates = bounds
    ? [`DTSTART:${stamp(bounds.start)}`, `DTEND:${stamp(bounds.end)}`]
    : [
        `DTSTART;VALUE=DATE:${trip.confirmedDate.replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${addCalendarDays(end, 1).replace(/-/g, "")}`,
      ];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Converge//Trip planning//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${encodeURIComponent(trip.id)}@${trip.calendarNamespace || "converge-planner.invalid"}`,
    `SEQUENCE:${trip.confirmationVersion}`,
    `DTSTAMP:${stamp(trip.confirmedAt || `${trip.confirmedDate}T00:00:00Z`)}`,
    ...dates,
    `SUMMARY:${escapeText(trip.name)}`,
    `DESCRIPTION:${escapeText(trip.notes || "Trip dates confirmed with Converge.")}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldLine)
    .join("\r\n");
}
export function downloadCalendarFile(trip: CalendarTrip) {
  const url = URL.createObjectURL(
    new Blob([buildCalendarFile(trip)], {
      type: "text/calendar;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "converge.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
