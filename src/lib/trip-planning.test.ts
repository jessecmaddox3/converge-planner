import { describe, expect, it } from "vitest";
import { parsePlanning, parseTripTiming } from "./trip-planning";

describe("organizer planning settings", () => {
  it("requires explicit, unique assignments to existing response identities", () => {
    expect(() => parsePlanning({ requiredResponseIds: ["someone-else"] }, ["guest-a"])).toThrow();
    expect(() => parsePlanning({ expectedPeople: [
      { id: "a", name: "Alex", responsePublicId: "guest-a" },
      { id: "b", name: "Blair", responsePublicId: "guest-a" },
    ] }, ["guest-a"])).toThrow();
    expect(parsePlanning({ expectedPeople: [{ id: "a", name: " Alex ", required: true }] }, [])).toMatchObject({ expectedPeople: [{ id: "a", name: "Alex", required: true }] });
  });
  it("validates exact timing for every proposed option", () => {
    expect(() => parseTripTiming({ timeZone: "America/New_York", departureTime: "02:30", returnTime: "18:00" }, ["2026-03-08"], 1)).toThrow();
    expect(() => parseTripTiming({ timeZone: "Moon/Sea" }, ["2026-10-09"], 3)).toThrow();
    expect(parseTripTiming({ timeZone: "America/New_York", departureTime: "18:00", returnTime: "18:00" }, ["2026-10-09"], 3)).toEqual({ timeZone: "America/New_York", departureTime: "18:00", returnTime: "18:00" });
  });
});
