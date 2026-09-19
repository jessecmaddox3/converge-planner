import type { ReactNode } from "react";
import type { DateAnswer } from "@/lib/availability";
import { dateRangeLabel, longDate } from "./trip-client";

export function AvailabilityChoices({
  date,
  duration,
  answer,
  favorite,
  onAnswer,
  onFavorite,
  disabled = false,
  calendarDetails,
}: {
  date: string;
  duration: number;
  answer?: DateAnswer;
  favorite: boolean;
  onAnswer: (answer?: DateAnswer) => void;
  onFavorite: () => void;
  disabled?: boolean;
  calendarDetails?: ReactNode;
}) {
  const options: { value: DateAnswer; label: string }[] = [
    { value: "available", label: "Available" },
    { value: "maybe", label: "Maybe" },
    { value: "unavailable", label: "Cannot" },
  ];
  return (
    <fieldset
      className={`answer-option ${answer || "unanswered"}`}
      disabled={disabled}
    >
      <legend className="sr-only">
        Availability for {dateRangeLabel(date, duration)}
      </legend>
      <div className="answer-heading">
        <h3>{dateRangeLabel(date, duration)}</h3>
        <button
          type="button"
          className="favorite-button"
          aria-label={`Favorite: ${longDate(date)}`}
          aria-pressed={favorite}
          disabled={answer !== "available" || disabled}
          onClick={onFavorite}
        >
          <span aria-hidden="true">{favorite ? "★" : "☆"}</span> Favorite
        </button>
      </div>
      {calendarDetails}
      <div className="answer-buttons">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            data-answer={option.value}
            aria-label={`${option.label}: ${longDate(date)}`}
            aria-pressed={answer === option.value}
            onClick={() => onAnswer(option.value)}
          >
            {answer === option.value && <span aria-hidden="true">✓ </span>}
            {option.label}
          </button>
        ))}
      </div>
      <div className="answer-foot">
        <span>
          {answer
            ? answer === "unavailable"
              ? "You cannot attend"
              : answer === "maybe"
                ? "You might be able to attend"
                : "You can attend"
            : "Unanswered"}
        </span>
        {answer && (
          <button
            type="button"
            className="text-button"
            aria-label={`Clear answer: ${longDate(date)}`}
            onClick={() => onAnswer(undefined)}
          >
            Clear
          </button>
        )}
      </div>
    </fieldset>
  );
}
