import { describe, expect, it } from "vitest";
import {
  initialDraft,
  updateDraft,
  readDraft,
  serializeDraft,
  draftError,
} from "./trip-draft";

describe("organizer draft", () => {
  it("keeps a valid latest date when the earliest date changes and removes invalid shortlist starts", () => {
    const draft = {
      ...initialDraft("2026-10-01"),
      name: "A trip",
      endDate: "2026-12-31",
      selectedDates: ["2026-10-09", "2026-11-06"],
    };
    expect(updateDraft(draft, { startDate: "2026-11-01" })).toMatchObject({
      endDate: "2026-12-31",
      selectedDates: ["2026-11-06"],
    });
  });
  it("recovers exact choices and setup across reloads but never stores calendar content", () => {
    const draft = {
      ...initialDraft("2026-10-01"),
      name: "Mountains",
      selectedDates: ["2026-10-09"],
      exploring: true,
      events: [{ title: "Private appointment" }],
    };
    const saved = serializeDraft(draft);
    expect(saved).not.toContain("Private appointment");
    expect(readDraft(saved)).toMatchObject({
      name: "Mountains",
      selectedDates: ["2026-10-09"],
      exploring: true,
    });
    expect(readDraft('{"version":99}')).toBeNull();
    expect(readDraft("invalid")).toBeNull();
  });
  it("rejects reversed ranges and ambiguous trip times with useful guidance", () => {
    const draft = {
      ...initialDraft("2026-10-01"),
      name: "Mountains",
      endDate: "2026-09-01",
    };
    expect(draftError(draft)).toMatch(/latest date/i);
    expect(
      draftError({
        ...draft,
        endDate: "2026-11-03",
        durationPreset: "custom",
        duration: 1,
        departureTime: "01:30",
        timeZone: "America/New_York",
      }),
    ).toMatch(/time/i);
  });
});
