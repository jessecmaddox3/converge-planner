export const AI_ADVICE_MAX_BODY_BYTES = 4_096;
export const AI_ADVICE_MAX_PROMPT_CHARS = 1_500;
export const AI_ADVICE_MAX_OUTPUT_TOKENS = 512;

export const AI_HISTORY_MAX_BODY_BYTES = 65_536;
export const AI_HISTORY_MAX_EVENTS = 120;
export const AI_HISTORY_MAX_USER_CHARS = 20_000;
export const AI_HISTORY_MAX_OUTPUT_TOKENS = 2_048;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADVICE_INSTRUCTION = " Give one sentence of scheduling advice.";

export interface AdvicePromptInput {
  tripName: string;
  duration: number;
  topConflicts: string;
  bestWindowDescription: string;
}

export interface AIHistoryEvent {
  id: string;
  title: string;
  date: string;
  calendar?: string;
  location?: string;
  duration?: string;
}

export interface HistorySample {
  events: AIHistoryEvent[];
  sampledEvents: number;
  totalEvents: number;
  copy: string | null;
}

export interface HistorySampleOptions {
  maxEvents?: number;
  maxUserChars?: number;
}

export function buildAdvicePrompt(input: AdvicePromptInput): string {
  const prefix =
    `Trip: "${input.tripName}", ${input.duration} days. ` +
    `Top conflicts: ${input.topConflicts}. ` +
    `Best window: ${input.bestWindowDescription}.`;
  const maxPrefixLength =
    AI_ADVICE_MAX_PROMPT_CHARS - ADVICE_INSTRUCTION.length;
  return prefix.slice(0, maxPrefixLength) + ADVICE_INSTRUCTION;
}

export function historyEventUserChars(input: unknown): number {
  if (!input || typeof input !== "object") return 0;
  const { id, title, date, calendar, location, duration } =
    input as Record<string, unknown>;
  let total = 0;
  for (const value of [id, title, date, calendar, location, duration]) {
    if (typeof value === "string") total += value.length;
  }
  return total;
}

export function normalizeAIHistoryEvent(input: unknown): AIHistoryEvent | null {
  if (!input || typeof input !== "object") return null;
  const { id, title, date, calendar, location, duration } =
    input as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !id ||
    typeof title !== "string" ||
    typeof date !== "string" ||
    !DATE_RE.test(date)
  ) {
    return null;
  }
  return {
    id,
    title: title.slice(0, 80),
    date,
    calendar:
      typeof calendar === "string" ? calendar.slice(0, 40) : undefined,
    location:
      typeof location === "string" ? location.slice(0, 80) : undefined,
    duration:
      typeof duration === "string" ? duration.slice(0, 20) : undefined,
  };
}

export function buildHistoryPayload(
  events: readonly unknown[],
): AIHistoryEvent[] {
  const payload: AIHistoryEvent[] = [];
  let userChars = 0;

  for (const event of events) {
    if (payload.length >= AI_HISTORY_MAX_EVENTS) break;
    const normalized = normalizeAIHistoryEvent(event);
    if (!normalized) continue;

    const eventChars = historyEventUserChars(normalized);
    if (userChars + eventChars > AI_HISTORY_MAX_USER_CHARS) break;
    userChars += eventChars;
    payload.push(normalized);
  }

  return payload;
}

function historyBucket(input: unknown, event: AIHistoryEvent): string {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const periodValue = record.historyPeriod ?? record.period;
  const period =
    typeof periodValue === "string" || typeof periodValue === "number"
      ? String(periodValue)
      : event.date.slice(0, 4);
  return `${period}|${event.calendar || "Unspecified"}`;
}

export function sampleHistoryEvents(
  inputs: readonly unknown[],
  options: HistorySampleOptions = {}
): HistorySample {
  const maxEvents = options.maxEvents ?? AI_HISTORY_MAX_EVENTS;
  const maxUserChars = options.maxUserChars ?? AI_HISTORY_MAX_USER_CHARS;
  const candidates = inputs
    .map((input) => {
      const event = normalizeAIHistoryEvent(input);
      return event ? { input, event, bucket: historyBucket(input, event) } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) =>
      left.event.id.localeCompare(right.event.id) ||
      left.event.date.localeCompare(right.event.date) ||
      (left.event.calendar || "").localeCompare(right.event.calendar || "") ||
      left.event.title.localeCompare(right.event.title)
    );

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.event.id)) unique.set(candidate.event.id, candidate);
  }

  const buckets = new Map<string, AIHistoryEvent[]>();
  for (const candidate of Array.from(unique.values())) {
    const bucket = buckets.get(candidate.bucket);
    if (bucket) bucket.push(candidate.event);
    else buckets.set(candidate.bucket, [candidate.event]);
  }
  const orderedBuckets = Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, events]) =>
      events.sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.id.localeCompare(right.id)
      )
    );

  const sampled: AIHistoryEvent[] = [];
  let userChars = 0;
  const maximumBucketLength = Math.max(
    0,
    ...orderedBuckets.map((bucket) => bucket.length)
  );
  for (
    let round = 0;
    round < maximumBucketLength && sampled.length < maxEvents;
    round += 1
  ) {
    for (const bucket of orderedBuckets) {
      const event = bucket[round];
      if (!event) continue;
      const eventChars = historyEventUserChars(event);
      if (userChars + eventChars > maxUserChars) continue;
      sampled.push(event);
      userChars += eventChars;
      if (sampled.length >= maxEvents) break;
    }
  }

  const totalEvents = unique.size;
  const sampledEvents = sampled.length;
  return {
    events: sampled,
    sampledEvents,
    totalEvents,
    copy:
      sampledEvents < totalEvents
        ? `${sampledEvents} of ${totalEvents} events summarized`
        : null,
  };
}
