import { useState } from "react";
import type { ManagedTrip } from "@/lib/store";
import { emptyPlanning, type PlanningSettings } from "@/lib/trip-planning";

export function ExpectedPeople({
  trip,
  disabled,
  onChange,
}: {
  trip: ManagedTrip;
  disabled: boolean;
  onChange: (planning: PlanningSettings) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const planning = trip.planning || emptyPlanning();
  return (
    <details className="guest-settings">
      <summary>
        Expected people <span className="muted">(optional)</span>
      </summary>
      <div className="stack" style={{ marginTop: 18 }}>
        <p className="muted small">
          Add names to track who still needs to answer. Match each person to
          their response when it arrives. This list is private to you.
        </p>
        <div className="add-person">
          <div className="field">
            <label htmlFor="expected-name">Someone you’re waiting for</label>
            <input
              id="expected-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="Name"
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={
              disabled || !name.trim() || planning.expectedPeople.length >= 100
            }
            onClick={async () => {
              if (
                await onChange({
                  ...planning,
                  expectedPeople: [
                    ...planning.expectedPeople,
                    {
                      id: crypto.randomUUID(),
                      name: name.trim(),
                      required: false,
                    },
                  ],
                })
              )
                setName("");
            }}
          >
            Add person
          </button>
        </div>
        {planning.expectedPeople.map((person) => (
          <div className="expected-person" key={person.id}>
            <div>
              <strong>{person.name}</strong>
              <label className="required-toggle">
                <input
                  type="checkbox"
                  aria-label={`Require expected ${person.name}`}
                  checked={person.required}
                  disabled={disabled}
                  onChange={(event) =>
                    void onChange({
                      ...planning,
                      expectedPeople: planning.expectedPeople.map((entry) =>
                        entry.id === person.id
                          ? { ...entry, required: event.target.checked }
                          : entry,
                      ),
                    })
                  }
                />
                Required
              </label>
            </div>
            <div className="field">
              <label className="sr-only" htmlFor={`match-${person.id}`}>
                Match response for {person.name}
              </label>
              <select
                id={`match-${person.id}`}
                disabled={disabled}
                value={person.responsePublicId || ""}
                onChange={(event) =>
                  void onChange({
                    ...planning,
                    expectedPeople: planning.expectedPeople.map((entry) =>
                      entry.id === person.id
                        ? {
                            id: entry.id,
                            name: entry.name,
                            required: entry.required,
                            ...(event.target.value
                              ? { responsePublicId: event.target.value }
                              : {}),
                          }
                        : entry,
                    ),
                  })
                }
              >
                <option value="">Waiting for a response</option>
                {trip.responses
                  .filter(
                    (response) =>
                      !planning.expectedPeople.some(
                        (other) =>
                          other.id !== person.id &&
                          other.responsePublicId === response.publicId,
                      ),
                  )
                  .map((response) => (
                    <option key={response.publicId} value={response.publicId}>
                      {response.name}
                      {response.email ? ` (${response.email})` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <button
              className="text-button"
              type="button"
              aria-label={`Remove expected ${person.name}`}
              disabled={disabled}
              onClick={() =>
                void onChange({
                  ...planning,
                  expectedPeople: planning.expectedPeople.filter(
                    (entry) => entry.id !== person.id,
                  ),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
