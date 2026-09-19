import { describe, expect, it } from "vitest";
import { parseAvailability } from "./trip-validation";
import { answerFor, answersForDates } from "./availability";
import { candidateTallies } from "@/components/converge/trip-client";
import type { PublicTripResponse } from "./store";

const trip = { selectedDates: ["2026-10-09", "2026-10-16"], confirmedDate: null };
describe("explicit availability", () => {
  it("keeps legacy omissions as Cannot and new omissions as Unanswered", () => {
    expect(answerFor({ selectedDates: [] }, "2026-10-09")).toBe("unavailable");
    expect(answerFor({ selectedDates: [], answerVersion: 2, answers: {} }, "2026-10-09")).toBe("unanswered");
    expect(answersForDates(null, trip.selectedDates)).toEqual({});
  });
  it("retains Maybe and an empty answer map as versioned partial responses", () => {
    expect(parseAvailability({ name: "Alex", answerVersion: 2, answers: { "2026-10-09": "maybe" }, selectedDates: [] }, trip)).toMatchObject({ answerVersion: 2, answers: { "2026-10-09": "maybe" }, selectedDates: [] });
    expect(parseAvailability({ name: "Alex", answerVersion: 2, answers: {}, selectedDates: [] }, trip)).toMatchObject({ answerVersion: 2, answers: {} });
  });
  it("rejects unproposed Maybe answers and favorites on unavailable dates", () => {
    expect(() => parseAvailability({ name: "Alex", answerVersion: 2, answers: { "2026-10-23": "maybe" }, selectedDates: [] }, trip)).toThrow("DATE_NOT_PROPOSED");
    expect(() => parseAvailability({ name: "Alex", answerVersion: 2, answers: { "2026-10-09": "maybe" }, selectedDates: ["2026-10-09"], preferences: { "2026-10-09": "preferred" } }, trip)).toThrow();
  });
  it("requires an explicit version when answers are supplied", () => {
    expect(() => parseAvailability({ name: "Alex", answers: {}, selectedDates: [] }, trip)).toThrow("INVALID_INPUT");
  });
});

describe("group ranking", () => {
  const responses: PublicTripResponse[] = [
    { publicId: "alex", name: "Alex", selectedDates: ["2026-10-09", "2026-10-16"], preferences: { "2026-10-09": "preferred" as const }, conflictCount: 0, submittedAt: "" },
    { publicId: "blair", name: "Blair", selectedDates: ["2026-10-16"], preferences: {}, conflictCount: 0, submittedAt: "" },
  ];
  it("ranks actual availability before favorites and counts the organizer exactly once", () => {
    const tallies = candidateTallies({ selectedDates: trip.selectedDates, responses });
    expect(tallies[0]).toMatchObject({ date: "2026-10-16", availableCount: 3, preferredCount: 0 });
    expect(tallies[1]).toMatchObject({ date: "2026-10-09", availableCount: 2, preferredCount: 1 });
  });
  it("separates required-person uncertainty from eligibility and known inability", () => {
    const tallies = candidateTallies({ selectedDates: trip.selectedDates, responses: [
      ...responses,
      { publicId: "casey", name: "Casey", selectedDates: [], preferences: {}, conflictCount: 0, submittedAt: "", answerVersion: 2, answers: { "2026-10-09": "unavailable" } },
    ], planning: { revision: 0, requiredResponseIds: ["casey"], expectedPeople: [], invitationsClosed: false } });
    expect(tallies[0]).toMatchObject({ date: "2026-10-16", eligibility: "needs-review", unansweredCount: 1 });
    expect(tallies[1]).toMatchObject({ date: "2026-10-09", eligibility: "blocked", requiredUnavailable: ["Casey"] });
  });
  it("counts an unlinked expected person as pending without double-counting linked people", () => {
    const [tally] = candidateTallies({ selectedDates: ["2026-10-16"], responses, planning: { revision: 0, requiredResponseIds: [], invitationsClosed: false, expectedPeople: [
      { id: "expected-a", name: "Alex", required: true, responsePublicId: "alex" },
      { id: "expected-c", name: "Casey", required: true },
    ] } });
    expect(tally).toMatchObject({ availableCount: 3, unansweredCount: 1, totalCount: 4, eligibility: "needs-review", requiredPending: ["Casey"] });
  });
});
