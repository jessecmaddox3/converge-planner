import { Fragment } from "react";
import type { ManagedTrip } from "@/lib/store";
import { answerFor, type AnswerState } from "@/lib/availability";
import { candidateTallies, dateRangeLabel } from "./trip-client";

const labels: Record<AnswerState, string> = {
  available: "Available",
  maybe: "Maybe",
  unavailable: "Cannot",
  unanswered: "Unanswered",
};
const symbols: Record<AnswerState, string> = {
  available: "✓",
  maybe: "?",
  unavailable: "−",
  unanswered: "○",
};

export function AvailabilityMatrix({
  trip,
  selectedDate,
  onSelect,
  onRequiredChange,
  disabled = false,
}: {
  trip: ManagedTrip;
  selectedDate: string;
  onSelect: (date: string) => void;
  onRequiredChange: (id: string, required: boolean) => void;
  disabled?: boolean;
}) {
  const tallies = candidateTallies(trip);
  const expected = trip.planning?.expectedPeople || [];
  const required = new Set(trip.planning?.requiredResponseIds || []);
  expected.forEach((person) => {
    if (person.required && person.responsePublicId)
      required.add(person.responsePublicId);
  });
  const unmatched = expected.filter(
    (person) =>
      !trip.responses.some(
        (response) => response.publicId === person.responsePublicId,
      ),
  );
  const cell = (answer: AnswerState, selected: boolean, favorite = false) => (
    <td className={selected ? "chosen-column" : ""}>
      <span className={`answer-cell ${answer}`}>
        <span aria-hidden="true">{symbols[answer]}</span>
        {labels[answer]}
        {favorite && (
          <span className="matrix-star" title="Favorite" aria-label="Favorite">
            ★
          </span>
        )}
      </span>
    </td>
  );
  return (
    <div
      className="matrix-scroll"
      tabIndex={0}
      role="region"
      aria-label="Scroll to compare date options"
    >
      <table
        className="availability-matrix"
        aria-label="Availability by person and date"
      >
        <caption className="sr-only">
          Counts include you. Required people are checked before overall
          attendance. Scroll horizontally to compare all dates.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="person-column">
              <span>People</span>
              <small>Counts include you</small>
            </th>
            {tallies.map((tally, index) => (
              <th
                scope="col"
                key={tally.date}
                className={selectedDate === tally.date ? "chosen-column" : ""}
              >
                <button
                  type="button"
                  className="matrix-option"
                  aria-label={`Choose ${dateRangeLabel(tally.date, trip.duration)}`}
                  aria-pressed={selectedDate === tally.date}
                  disabled={disabled}
                  onClick={() => onSelect(tally.date)}
                >
                  <span
                    className={`badge ${tally.eligibility === "blocked" ? "danger" : tally.eligibility === "needs-review" ? "warning" : ""}`}
                  >
                    {tally.eligibility === "blocked"
                      ? "Required person unavailable"
                      : tally.eligibility === "needs-review"
                        ? "Check required people"
                        : index === 0 && trip.responses.length > 0
                          ? "Most available"
                          : "Date option"}
                  </span>
                  <strong>{dateRangeLabel(tally.date, trip.duration)}</strong>
                  <span>
                    {tally.availableCount} of {tally.totalCount} available
                  </span>
                  <small>
                    {tally.maybeCount} maybe, {tally.unansweredCount} unanswered
                  </small>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="person-column">
              <strong>
                {trip.organizerName || "Organizer"}{" "}
                <span className="muted">(you)</span>
              </strong>
              <small>Organizer</small>
            </th>
            {tallies.map((tally) => (
              <td
                key={tally.date}
                className={selectedDate === tally.date ? "chosen-column" : ""}
              >
                <span className="answer-cell available">
                  <span aria-hidden="true">✓</span>Available
                </span>
              </td>
            ))}
          </tr>
          {trip.responses.map((response) => (
            <tr key={response.publicId}>
              <th scope="row" className="person-column">
                <strong>{response.name}</strong>
                <label className="required-toggle">
                  <input
                    type="checkbox"
                    aria-label={`Require ${response.name}`}
                    checked={required.has(response.publicId)}
                    disabled={
                      disabled ||
                      expected.some(
                        (person) =>
                          person.required &&
                          person.responsePublicId === response.publicId,
                      )
                    }
                    onChange={(event) =>
                      onRequiredChange(response.publicId, event.target.checked)
                    }
                  />
                  Required
                </label>
              </th>
              {tallies.map((tally) => (
                <Fragment key={tally.date}>
                  {cell(
                    answerFor(response, tally.date),
                    selectedDate === tally.date,
                    answerFor(response, tally.date) === "available" &&
                      response.preferences[tally.date] === "preferred",
                  )}
                </Fragment>
              ))}
            </tr>
          ))}
          {unmatched.map((person) => (
            <tr key={`expected:${person.id}`}>
              <th scope="row" className="person-column">
                <strong>{person.name}</strong>
                <small>
                  {person.required
                    ? "Required; not responded"
                    : "Not responded"}
                </small>
              </th>
              {tallies.map((tally) => (
                <Fragment key={tally.date}>
                  {cell("unanswered", selectedDate === tally.date)}
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
