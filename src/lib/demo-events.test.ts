import { describe, expect, it } from "vitest";
import { generateDemoEvents } from "@/lib/demo-events";

describe("generateDemoEvents", () => {
  it("keeps date-only bounds on their Eastern calendar dates across DST", () => {
    const events = generateDemoEvents("2026-03-08", "2026-03-09", () => 0.75);

    expect(new Set(events.map((event) => event.date))).toEqual(
      new Set(["2026-03-08", "2026-03-09"])
    );
    expect(events.every((event) => event.date >= "2026-03-08" && event.date <= "2026-03-09"))
      .toBe(true);
  });
});
