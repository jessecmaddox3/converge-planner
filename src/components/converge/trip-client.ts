import type { ManagedTrip, PublicTrip, TripSummary } from "@/lib/store";
import { answerFor } from "@/lib/availability";
import type { PlanningSettings } from "@/lib/trip-planning";

type LocationAssigner = Pick<Location, "assign">;

type ErrorPayload = {
  error?:
    | string
    | {
        message?: string;
      };
};

type TripWithPublicResponses = Pick<
  ManagedTrip | PublicTrip,
  "selectedDates" | "responses"
> & { planning?: PlanningSettings; organizerName?: string };

export interface CandidateTally {
  date: string;
  availableCount: number;
  preferredCount: number;
  weightedScore: number;
  maybeCount: number;
  unavailableCount: number;
  unansweredCount: number;
  totalCount: number;
  eligibility: "eligible" | "needs-review" | "blocked";
  requiredUnavailable: string[];
  requiredPending: string[];
  reason: string;
}

export function manageTripPath(tripId: string): string {
  return `/manage/${encodeURIComponent(tripId)}`;
}

export function joinTripPath(tripId: string): string {
  return `/join/${encodeURIComponent(tripId)}`;
}

export function assignManagedTrip(
  tripId: string,
  location: LocationAssigner,
): void {
  location.assign(manageTripPath(tripId));
}

export function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as ErrorPayload).error;
  if (typeof error === "string" && error) return error;
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}

function localDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function shortDate(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function longDate(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function exactDateRange(startDate: string, duration: number): string {
  const start = localDate(startDate);
  const end = localDate(startDate);
  end.setDate(end.getDate() + duration - 1);
  const format = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return duration <= 1 ? format(start) : `${format(start)} to ${format(end)}`;
}

export function optionYears(
  trip: Pick<PublicTrip, "selectedDates" | "duration">,
): string {
  const years = Array.from(
    new Set(
      trip.selectedDates.flatMap((date) => {
        const end = localDate(date);
        end.setDate(end.getDate() + trip.duration - 1);
        return [date.slice(0, 4), String(end.getFullYear())];
      }),
    ),
  ).sort();
  return years.length > 1
    ? `${years[0]} to ${years[years.length - 1]}`
    : years[0] || "";
}

export function dateRangeLabel(startDate: string, duration: number): string {
  const start = localDate(startDate);
  if (duration <= 1) {
    return start.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const end = localDate(startDate);
  end.setDate(end.getDate() + duration - 1);
  return `${start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} to ${end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

export function candidateTallies(
  trip: TripWithPublicResponses,
): CandidateTally[] {
  const expected = trip.planning?.expectedPeople || [];
  const unmatched = expected.filter(
    (person) =>
      !trip.responses.some(
        (response) => response.publicId === person.responsePublicId,
      ),
  );
  const required = new Set(trip.planning?.requiredResponseIds || []);
  expected.forEach((person) => {
    if (person.required && person.responsePublicId)
      required.add(person.responsePublicId);
  });
  const tallies: CandidateTally[] = trip.selectedDates.map((date) => {
    let availableCount = 1;
    let preferredCount = 0;
    let maybeCount = 0;
    let unavailableCount = 0;
    let unansweredCount = unmatched.length;
    const requiredUnavailable: string[] = [];
    const requiredPending: string[] = unmatched
      .filter((person) => person.required)
      .map((person) => person.name);
    for (const response of trip.responses) {
      const answer = answerFor(response, date);
      if (answer === "available") {
        availableCount++;
        if (response.preferences[date] === "preferred") preferredCount++;
      } else if (answer === "maybe") maybeCount++;
      else if (answer === "unavailable") unavailableCount++;
      else unansweredCount++;
      if (required.has(response.publicId)) {
        if (answer === "unavailable") requiredUnavailable.push(response.name);
        else if (answer !== "available") requiredPending.push(response.name);
      }
    }
    const eligibility = requiredUnavailable.length
      ? "blocked"
      : requiredPending.length
        ? "needs-review"
        : "eligible";
    let reason = `${availableCount} available, including you`;
    if (maybeCount) reason += `; ${maybeCount} maybe`;
    if (unansweredCount) reason += `; ${unansweredCount} unanswered`;
    if (requiredUnavailable.length)
      reason += `; required: ${requiredUnavailable.join(", ")} cannot attend`;
    else if (requiredPending.length)
      reason += `; check with ${requiredPending.join(", ")}`;
    else if (required.size || expected.some((person) => person.required))
      reason += "; all required people are available";
    return {
      date,
      availableCount,
      preferredCount,
      weightedScore: availableCount + preferredCount * 0.5,
      maybeCount,
      unavailableCount,
      unansweredCount,
      totalCount: trip.responses.length + unmatched.length + 1,
      eligibility,
      requiredUnavailable,
      requiredPending,
      reason,
    };
  });
  const eligibilityOrder = { eligible: 0, "needs-review": 1, blocked: 2 };
  return tallies.sort(
    (a, b) =>
      eligibilityOrder[a.eligibility] - eligibilityOrder[b.eligibility] ||
      b.availableCount - a.availableCount ||
      b.maybeCount - a.maybeCount ||
      b.preferredCount - a.preferredCount ||
      a.date.localeCompare(b.date),
  );
}

export function tripSummaryPath(trip: TripSummary): string {
  return trip.role === "organizer"
    ? manageTripPath(trip.id)
    : joinTripPath(trip.id);
}
