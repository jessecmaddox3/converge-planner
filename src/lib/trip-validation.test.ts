import { describe, expect, it } from "vitest";
import {
  generateCandidateStarts,
  isLocalDate,
  parseAvailability,
  parseCreateTrip,
  type CreateTripInput,
} from "@/lib/trip-validation";

const base: CreateTripInput = {
  name: "Beach Trip",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  duration: 3,
  durationPreset: "weekend",
  notes: "",
  selectedDates: ["2026-10-02", "2026-10-09"],
};

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base, ...overrides };
}

describe("isLocalDate", () => {
  it.each([
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-2-03", false],
    ["not-a-date", false],
    ["2025-02-29", false],
    ["0001-01-01", true],
    ["2024-02-29", true],
    ["2026-10-09", true],
  ])("classifies %s as %s", (value, expected) => {
    expect(isLocalDate(value)).toBe(expected);
  });
});

describe("generateCandidateStarts", () => {
  it("rejects a 367-day inclusive range directly", () => {
    expect(() => generateCandidateStarts({
      startDate: "2026-01-01",
      endDate: "2027-01-02",
      preset: "day",
      duration: 1,
    })).toThrow("RANGE_TOO_LARGE");
  });

  it("generates every day for day trips", () => {
    expect(generateCandidateStarts({
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      preset: "day",
      duration: 1,
    })).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("generates Friday starts whose weekends fit", () => {
    expect(generateCandidateStarts({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      preset: "weekend",
      duration: 3,
    })).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"]);
  });

  it("generates Monday starts whose weeks fit", () => {
    expect(generateCandidateStarts({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      preset: "week",
      duration: 7,
    })).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
  });

  it("generates every fitting custom start", () => {
    expect(generateCandidateStarts({
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      preset: "custom",
      duration: 3,
    })).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("keeps consecutive custom candidates across Eastern daylight saving time", () => {
    expect(generateCandidateStarts({
      startDate: "2026-03-07",
      endDate: "2026-03-11",
      preset: "custom",
      duration: 2,
    })).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
  });
});

describe("parseCreateTrip", () => {
  it.each([
    ["rejects a blank trip name", { name: "   " }, "INVALID_NAME"],
    ["rejects a trip name over two hundred characters", { name: "x".repeat(201) }, "INVALID_NAME"],
    ["rejects an impossible start date", { startDate: "2026-02-30" }, "INVALID_DATE"],
    ["rejects an impossible end date", { endDate: "2026-11-31" }, "INVALID_DATE"],
    ["rejects a reversed range", { startDate: "2026-11-01" }, "DATE_RANGE_REVERSED"],
    [
      "rejects a 367-day inclusive range",
      { startDate: "2026-01-01", endDate: "2027-01-02", selectedDates: ["2026-01-02"] },
      "RANGE_TOO_LARGE",
    ],
    ["rejects a day duration mismatch", { durationPreset: "day", duration: 2 }, "INVALID_DURATION"],
    ["rejects a weekend duration mismatch", { durationPreset: "weekend", duration: 2 }, "INVALID_DURATION"],
    ["rejects a week duration mismatch", { durationPreset: "week", duration: 6 }, "INVALID_DURATION"],
    ["rejects a zero-day custom duration", { durationPreset: "custom", duration: 0 }, "INVALID_DURATION"],
    ["rejects a fifteen-day custom duration", { durationPreset: "custom", duration: 15 }, "INVALID_DURATION"],
    ["rejects an unknown preset", { durationPreset: "fortnight" }, "INVALID_PRESET"],
    ["rejects notes over two thousand characters", { notes: "x".repeat(2001) }, "INVALID_NOTES"],
    ["rejects duplicate candidates", { selectedDates: ["2026-10-02", "2026-10-02"] }, "DUPLICATE_CANDIDATE"],
    ["rejects a weekend candidate that is not Friday", { selectedDates: ["2026-10-03"] }, "INVALID_CANDIDATE"],
    ["rejects a weekend candidate that overflows the range", { selectedDates: ["2026-10-30"] }, "INVALID_CANDIDATE"],
    ["rejects no organizer candidates", { selectedDates: [] }, "INVALID_CANDIDATE_COUNT"],
    ["rejects more than one hundred organizer candidates", {
      durationPreset: "day",
      duration: 1,
      startDate: "2026-01-01",
      endDate: "2026-04-11",
      selectedDates: Array.from({ length: 101 }, (_, index) => {
        const date = new Date(2026, 0, 1, 12);
        date.setDate(date.getDate() + index);
        return [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
      }),
    }, "INVALID_CANDIDATE_COUNT"],
  ])("%s", (_name, overrides, code) => {
    expect(() => parseCreateTrip(valid(overrides))).toThrow(code);
  });

  it("accepts a leap date and a 366-day inclusive range", () => {
    const parsed = parseCreateTrip(valid({
      durationPreset: "day",
      duration: 1,
      startDate: "2024-02-29",
      endDate: "2025-02-28",
      selectedDates: ["2024-02-29"],
    }));
    expect(parsed.startDate).toBe("2024-02-29");
    expect(parsed.endDate).toBe("2025-02-28");
  });

  it.each([
    ["custom duration one", 1, "2026-10-02", ["2026-10-01", "2026-10-02"]],
    ["custom duration fourteen", 14, "2026-10-14", ["2026-10-01"]],
  ])("accepts %s", (_name, duration, endDate, selectedDates) => {
    const parsed = parseCreateTrip(valid({
      durationPreset: "custom",
      duration,
      startDate: "2026-10-01",
      endDate,
      selectedDates,
    }));
    expect(parsed.duration).toBe(duration);
    expect(parsed.selectedDates).toEqual(selectedDates);
  });

  it("accepts exact organizer text and candidate count limits", () => {
    const selectedDates = Array.from({ length: 100 }, (_, index) => {
      const date = new Date(2026, 0, 1, 12);
      date.setDate(date.getDate() + index);
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
    });
    const parsed = parseCreateTrip(valid({
      name: "n".repeat(200),
      notes: "x".repeat(2000),
      durationPreset: "day",
      duration: 1,
      startDate: "2026-01-01",
      endDate: "2026-04-10",
      selectedDates,
    }));
    expect(parsed.name).toHaveLength(200);
    expect(parsed.notes).toHaveLength(2000);
    expect(parsed.selectedDates).toHaveLength(100);
  });

  it("trims text, defaults notes, and ignores client identity fields", () => {
    const parsed = parseCreateTrip({
      ...valid(),
      name: "  Beach Trip  ",
      notes: undefined,
      organizerName: "Spoofed",
      organizerEmail: "spoofed@example.com",
    });
    expect(parsed).toEqual({ ...base, name: "Beach Trip" });
    expect(parsed).not.toHaveProperty("organizerName");
    expect(parsed).not.toHaveProperty("organizerEmail");
  });
});

describe("parseAvailability", () => {
  const trip = {
    selectedDates: ["2026-10-02", "2026-10-09"],
    confirmedDate: null,
  };

  it("accepts empty availability to mean none work", () => {
    expect(parseAvailability({ name: "A", selectedDates: [] }, trip)).toEqual({
      name: "A",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
    });
  });

  it("accepts preferences only for selected organizer candidates", () => {
    expect(parseAvailability({
      name: "  Alex  ",
      selectedDates: ["2026-10-09"],
      preferences: { "2026-10-09": "preferred" },
      conflictCount: 1000,
    }, trip)).toEqual({
      name: "Alex",
      selectedDates: ["2026-10-09"],
      preferences: { "2026-10-09": "preferred" },
      conflictCount: 1000,
    });
  });

  it("accepts an absent, empty, or whitespace-only email as no email", () => {
    for (const emailInput of [{}, { email: "" }, { email: "   " }]) {
      expect(parseAvailability({
        name: "A",
        selectedDates: [],
        ...emailInput,
      }, trip)).toEqual({
        name: "A",
        selectedDates: [],
        preferences: {},
        conflictCount: 0,
      });
    }
  });

  it("trims and accepts a well-formed email", () => {
    expect(parseAvailability({
      name: "A",
      selectedDates: [],
      email: "  Alex@Example.com  ",
    }, trip)).toEqual({
      name: "A",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      email: "Alex@Example.com",
    });
  });

  it.each([
    ["rejects an email missing an @", { name: "A", selectedDates: [], email: "not-an-email" }, "INVALID_INPUT"],
    ["rejects an email missing a domain dot", { name: "A", selectedDates: [], email: "a@b" }, "INVALID_INPUT"],
    ["rejects an email over two hundred characters", {
      name: "A",
      selectedDates: [],
      email: `${"a".repeat(196)}@b.co`,
    }, "INVALID_INPUT"],
    ["rejects a non-string email", { name: "A", selectedDates: [], email: 12345 }, "INVALID_INPUT"],
  ])("%s", (_name, input, code) => {
    expect(() => parseAvailability(input, trip)).toThrow(code);
  });

  it("accepts the exact respondent name limit and available preference", () => {
    expect(parseAvailability({
      name: "n".repeat(100),
      selectedDates: ["2026-10-02"],
      preferences: { "2026-10-02": "available" },
      conflictCount: 0,
    }, trip)).toEqual({
      name: "n".repeat(100),
      selectedDates: ["2026-10-02"],
      preferences: { "2026-10-02": "available" },
      conflictCount: 0,
    });
  });

  it.each([
    ["rejects a blank respondent name", { name: "  ", selectedDates: [] }, "INVALID_NAME"],
    ["rejects a respondent name over one hundred characters", { name: "x".repeat(101), selectedDates: [] }, "INVALID_NAME"],
    ["rejects dates the organizer did not propose", { name: "A", selectedDates: ["2026-10-30"] }, "DATE_NOT_PROPOSED"],
    ["rejects duplicate selected dates", { name: "A", selectedDates: ["2026-10-02", "2026-10-02"] }, "DUPLICATE_DATE"],
    ["rejects preference keys outside selected dates", {
      name: "A",
      selectedDates: ["2026-10-02"],
      preferences: { "2026-10-09": "preferred" },
    }, "PREFERENCE_DATE_NOT_SELECTED"],
    ["rejects unsupported preference values", {
      name: "A",
      selectedDates: ["2026-10-02"],
      preferences: { "2026-10-02": "unavailable" },
    }, "INVALID_PREFERENCE"],
    ["rejects negative conflict counts", { name: "A", selectedDates: [], conflictCount: -1 }, "INVALID_CONFLICT_COUNT"],
    ["rejects fractional conflict counts", { name: "A", selectedDates: [], conflictCount: 1.5 }, "INVALID_CONFLICT_COUNT"],
    ["rejects conflict counts over one thousand", { name: "A", selectedDates: [], conflictCount: 1001 }, "INVALID_CONFLICT_COUNT"],
  ])("%s", (_name, input, code) => {
    expect(() => parseAvailability(input, trip)).toThrow(code);
  });

  it("rejects availability after confirmation", () => {
    expect(() => parseAvailability(
      { name: "A", selectedDates: [] },
      { ...trip, confirmedDate: "2026-10-02" },
    )).toThrow("TRIP_CONFIRMED");
  });
});
