import { describe, expect, it } from "vitest";
import {
  AI_ADVICE_MAX_PROMPT_CHARS,
  AI_HISTORY_MAX_EVENTS,
  AI_HISTORY_MAX_USER_CHARS,
  buildAdvicePrompt,
  buildHistoryPayload,
  historyEventUserChars,
  sampleHistoryEvents,
} from "@/lib/ai-inputs";

function historyEvent(index: number) {
  return {
    id: `google:event-${index}`,
    title: `Event ${index}`,
    date: "2026-07-23",
    calendar: "Personal",
    location: "Alder Quay",
    duration: "1 hour",
  };
}

describe("buildAdvicePrompt", () => {
  it("preserves the existing prompt shape for ordinary advice", () => {
    expect(buildAdvicePrompt({
      tripName: "Beach trip",
      duration: 3,
      topConflicts: "Dentist (2026-07-23, score 8)",
      bestWindowDescription: "2026-08-01 to 2026-08-03 (score 2)",
    })).toBe(
      'Trip: "Beach trip", 3 days. Top conflicts: Dentist (2026-07-23, score 8). ' +
      "Best window: 2026-08-01 to 2026-08-03 (score 2). " +
      "Give one sentence of scheduling advice.",
    );
  });

  it("bounds a large prompt while preserving the scheduling instruction", () => {
    const prompt = buildAdvicePrompt({
      tripName: "x".repeat(2_000),
      duration: 14,
      topConflicts: "y".repeat(2_000),
      bestWindowDescription: "z".repeat(2_000),
    });

    expect(prompt).toHaveLength(AI_ADVICE_MAX_PROMPT_CHARS);
    expect(prompt).toMatch(/Give one sentence of scheduling advice\.$/);
  });
});

describe("buildHistoryPayload", () => {
  it("caps the payload at 120 events", () => {
    const payload = buildHistoryPayload(
      Array.from({ length: 125 }, (_, index) => historyEvent(index)),
    );

    expect(payload).toHaveLength(AI_HISTORY_MAX_EVENTS);
    expect(payload.at(-1)?.id).toBe("google:event-119");
  });

  it("preserves event IDs and consistently slices display fields", () => {
    const id = "google:" + "opaque-id-".repeat(20);
    const [event] = buildHistoryPayload([{
      id,
      title: "t".repeat(100),
      date: "2026-07-23",
      calendar: "c".repeat(60),
      location: "l".repeat(100),
      duration: "d".repeat(40),
    }]);

    expect(event).toEqual({
      id,
      title: "t".repeat(80),
      date: "2026-07-23",
      calendar: "c".repeat(40),
      location: "l".repeat(80),
      duration: "d".repeat(20),
    });
  });

  it("stops before the aggregate character budget and may safely return fewer than two events", () => {
    const first = {
      ...historyEvent(0),
      id: "g".repeat(AI_HISTORY_MAX_USER_CHARS - 60),
    };
    const second = historyEvent(1);
    const payload = buildHistoryPayload([first, second, historyEvent(2)]);

    expect(payload).toHaveLength(1);
    expect(payload[0].id).toBe(first.id);
    expect(
      payload.reduce((total, event) => total + historyEventUserChars(event), 0),
    ).toBeLessThanOrEqual(AI_HISTORY_MAX_USER_CHARS);
  });
});

describe("sampleHistoryEvents", () => {
  it("deduplicates exact event IDs before sampling", () => {
    const first = { ...historyEvent(1), historyPeriod: "2025" };
    const result = sampleHistoryEvents([first, { ...first }, {
      ...historyEvent(2),
      historyPeriod: "2024",
    }]);

    expect(result.totalEvents).toBe(2);
    expect(result.events.map((event) => event.id).sort()).toEqual([
      "google:event-1",
      "google:event-2",
    ]);
  });

  it("round-robins across period and calendar buckets", () => {
    const events = [
      ...Array.from({ length: 5 }, (_, index) => ({
        ...historyEvent(index),
        historyPeriod: "2025",
        calendar: "Work",
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        ...historyEvent(index + 10),
        historyPeriod: "2024",
        calendar: "Family",
      })),
    ];

    const result = sampleHistoryEvents(events, { maxEvents: 4 });

    expect(result.events.filter((event) => event.calendar === "Work")).toHaveLength(2);
    expect(result.events.filter((event) => event.calendar === "Family")).toHaveLength(2);
  });

  it("is deterministic regardless of provider input order", () => {
    const events = [
      { ...historyEvent(3), date: "2025-10-03", calendar: "Work" },
      { ...historyEvent(1), date: "2024-10-01", calendar: "Family" },
      { ...historyEvent(2), date: "2025-10-02", calendar: "Family" },
    ];

    expect(sampleHistoryEvents(events).events).toEqual(
      sampleHistoryEvents([...events].reverse()).events
    );
  });

  it("returns explicit cap copy whenever not every event is sampled", () => {
    const result = sampleHistoryEvents(
      Array.from({ length: 5 }, (_, index) => historyEvent(index)),
      { maxEvents: 3 }
    );

    expect(result).toMatchObject({
      sampledEvents: 3,
      totalEvents: 5,
      copy: "3 of 5 events summarized",
    });
  });
});
