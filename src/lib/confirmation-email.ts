import { runtimeConfig } from "./runtime/config";
import { answerFor } from "./availability";
import { addCalendarDays } from "./calendar/range";
import { buildCalendarFile } from "./calendar-download";
import type { Trip } from "./store";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function confirmationEmail(trip: Trip) {
  if (!trip.confirmedDate) throw new Error("Trip is not confirmed");
  const format = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const range = `${format(trip.confirmedDate)}${trip.duration > 1 ? ` to ${format(addCalendarDays(trip.confirmedDate, trip.duration - 1))}` : ""}`;
  const timing =
    trip.departureTime || trip.returnTime
      ? `Departure: ${trip.departureTime || "start of day"}. Return: ${trip.returnTime || "end of day"}. Time zone: ${trip.timeZone || "UTC"}.`
      : "Whole days";
  const groups = [
    {
      label: "Available",
      names: [
        `${trip.organizerName} (organizer)`,
        ...trip.responses
          .filter((r) => answerFor(r, trip.confirmedDate!) === "available")
          .map((r) => r.name),
      ],
    },
    ...(
      [
        ["maybe", "Maybe"],
        ["unavailable", "Cannot"],
        ["unanswered", "Unanswered"],
      ] as const
    ).map(([state, label]) => ({
      label,
      names: trip.responses
        .filter((r) => answerFor(r, trip.confirmedDate!) === state)
        .map((r) => r.name),
    })),
  ].filter((group) => group.names.length);
  const base = process.env.NODE_ENV === 'test' && !process.env.CONVERGE_MODE
    ? (process.env.NEXTAUTH_URL || 'https://trips.example.invalid')
    : runtimeConfig().origin;
  const url = `${base.replace(/\/$/, "")}/join/${encodeURIComponent(trip.id)}`;
  const text = [
    `${trip.name}: dates confirmed`,
    range,
    timing,
    "Availability for these dates (this is not an attendance RSVP):",
    ...groups.map((g) => `${g.label}: ${g.names.join(", ")}`),
    url,
  ].join("\n\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;line-height:1.6"><h1>${escapeHtml(trip.name)}</h1><p>Dates confirmed</p><h2>${escapeHtml(range)}</h2><p>${escapeHtml(timing)}</p><p>Availability for these dates (this is not an attendance RSVP):</p>${groups.map((g) => `<p><strong>${g.label}:</strong> ${escapeHtml(g.names.join(", "))}</p>`).join("")}<p><a href="${escapeHtml(url)}">View trip details</a></p><p>The attached calendar file adds these dates to your calendar.</p></div>`;
  return {
    subject: `${trip.name}: dates confirmed`,
    text,
    html,
    attachments: [
      {
        filename: "converge.ics",
        content: buildCalendarFile(trip),
        contentType: "text/calendar; charset=utf-8",
      },
    ],
  };
}
