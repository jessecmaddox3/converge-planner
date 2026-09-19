import type { TripDraft } from "@/lib/trip-draft";
import type { TripPreset } from "@/lib/trip-validation";

const presets: {
  id: TripPreset;
  label: string;
  description: string;
  days: number;
}[] = [
  { id: "weekend", label: "Weekend", description: "Friday to Sunday", days: 3 },
  { id: "day", label: "One day", description: "Any day", days: 1 },
  { id: "week", label: "Full week", description: "Monday to Sunday", days: 7 },
  {
    id: "custom",
    label: "Flexible stay",
    description: "Choose the length",
    days: 3,
  },
];
export function TripSetup({
  draft,
  onChange,
  onExplore,
  error,
}: {
  draft: TripDraft;
  onChange: (value: Partial<TripDraft>) => void;
  onExplore: () => void;
  error: string;
}) {
  return (
    <form
      className="setup-panel panel stack"
      onSubmit={(event) => {
        event.preventDefault();
        onExplore();
      }}
    >
      <div className="field">
        <label htmlFor="trip-name">What are you planning?</label>
        <input
          id="trip-name"
          placeholder="A weekend in the mountains"
          value={draft.name}
          maxLength={200}
          required
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <fieldset className="preset-field">
        <legend>How long?</legend>
        <div className="preset-options">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={draft.durationPreset === preset.id}
              onClick={() =>
                onChange({ durationPreset: preset.id, duration: preset.days })
              }
            >
              <strong>{preset.label}</strong>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>
      </fieldset>
      {draft.durationPreset === "custom" && (
        <div className="field">
          <label htmlFor="trip-days">Days away, including travel days</label>
          <select
            id="trip-days"
            value={draft.duration}
            onChange={(event) =>
              onChange({ duration: Number(event.target.value) })
            }
          >
            {Array.from({ length: 14 }, (_, index) => (
              <option key={index} value={index + 1}>
                {index + 1} {index === 0 ? "day" : "days"}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="range-start">Earliest departure</label>
          <input
            id="range-start"
            type="date"
            required
            value={draft.startDate}
            onInput={(event) =>
              onChange({ startDate: event.currentTarget.value })
            }
            onChange={(event) => onChange({ startDate: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="range-end">Latest return</label>
          <input
            id="range-end"
            type="date"
            required
            value={draft.endDate}
            min={draft.startDate}
            onInput={(event) =>
              onChange({ endDate: event.currentTarget.value })
            }
            onChange={(event) => onChange({ endDate: event.target.value })}
          />
        </div>
      </div>
      <details className="setup-details">
        <summary>
          Travel times & trip notes <span className="muted">(optional)</span>
        </summary>
        <div className="stack">
          <p className="muted small">
            We check whole days unless you set travel times. These times apply
            to every option.
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="departure-time">Departure on the first day</label>
              <input
                id="departure-time"
                type="time"
                value={draft.departureTime}
                onInput={(event) =>
                  onChange({ departureTime: event.currentTarget.value })
                }
                onChange={(event) =>
                  onChange({ departureTime: event.target.value })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="return-time">Return on the last day</label>
              <input
                id="return-time"
                type="time"
                value={draft.returnTime}
                onInput={(event) =>
                  onChange({ returnTime: event.currentTarget.value })
                }
                onChange={(event) =>
                  onChange({ returnTime: event.target.value })
                }
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="trip-zone">Trip timezone</label>
            <input
              id="trip-zone"
              list="timezones"
              value={draft.timeZone}
              onChange={(event) => onChange({ timeZone: event.target.value })}
            />
            <datalist id="timezones">
              {[
                "America/New_York",
                "America/Chicago",
                "America/Denver",
                "America/Los_Angeles",
                "Europe/London",
                "Europe/Paris",
                "Asia/Tokyo",
                "Australia/Sydney",
                "UTC",
              ].map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <small>
              For example, America/New_York. Use the timezone for your departure
              and return.
            </small>
          </div>
          <div className="field">
            <label htmlFor="trip-notes">A note for your people</label>
            <textarea
              id="trip-notes"
              placeholder="What should everyone know?"
              value={draft.notes}
              maxLength={2000}
              onChange={(event) => onChange({ notes: event.target.value })}
            />
          </div>
        </div>
      </details>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="setup-submit">
        <p className="muted small">
          Browse dates first. Connect your calendar whenever you’re ready.
        </p>
        <button className="button" type="submit">
          Find dates <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}
