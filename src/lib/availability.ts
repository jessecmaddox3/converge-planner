export type DateAnswer = "available" | "maybe" | "unavailable";
export interface VersionedAnswers {
  answerVersion?: 2;
  answers?: Record<string, DateAnswer>;
}
export type AnswerState = DateAnswer | "unanswered";

export function isDateAnswer(value: unknown): value is DateAnswer {
  return value === "available" || value === "maybe" || value === "unavailable";
}

export function versionedAnswers(value: VersionedAnswers): VersionedAnswers {
  if (value.answerVersion !== 2) return {};
  const answers: Record<string, DateAnswer> = {};
  for (const [date, answer] of Object.entries(value.answers || {})) {
    if (isDateAnswer(answer) && /^\d{4}-\d{2}-\d{2}$/.test(date)) answers[date] = answer;
  }
  return { answerVersion: 2, answers };
}

export function answerFor(response: (VersionedAnswers & { selectedDates: string[] }) | null | undefined, date: string): AnswerState {
  if (!response) return "unanswered";
  if (response.answerVersion === 2) return response.answers?.[date] || "unanswered";
  return response.selectedDates.includes(date) ? "available" : "unavailable";
}

export function answersForDates(response: (VersionedAnswers & { selectedDates: string[] }) | null, dates: string[]): Record<string, DateAnswer> {
  const answers: Record<string, DateAnswer> = {};
  for (const date of dates) {
    const answer = answerFor(response, date);
    if (answer !== "unanswered") answers[date] = answer;
  }
  return answers;
}
