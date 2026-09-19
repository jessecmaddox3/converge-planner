import { describe, expect, it } from "vitest";
import {
  CalendarRangeError,
  occupiedDates,
  shiftHistoricalRange,
  validateScanRange,
} from "@/lib/calendar/range";

describe("validateScanRange", () => {
  it("rejects an invalid timezone", () => {
    expect(() =>
      validateScanRange({
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        timeZone: "Mars/Olympus",
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_TIMEZONE" }));
  });

  it("allows 366 inclusive days and rejects 367", () => {
    expect(
      validateScanRange({
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        timeZone: "America/New_York",
      }).inclusiveDays
    ).toBe(366);

    expect(() =>
      validateScanRange({
        startDate: "2026-01-01",
        endDate: "2027-01-02",
        timeZone: "America/New_York",
      })
    ).toThrowError(expect.objectContaining({ code: "RANGE_TOO_LARGE" }));
  });

  it("rejects invalid real dates and reversed ranges", () => {
    expect(() =>
      validateScanRange({
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        timeZone: "UTC",
      })
    ).toThrow(CalendarRangeError);
    expect(() =>
      validateScanRange({
        startDate: "2026-03-02",
        endDate: "2026-03-01",
        timeZone: "UTC",
      })
    ).toThrowError(expect.objectContaining({ code: "RANGE_REVERSED" }));
  });
});

describe("occupiedDates", () => {
  const range = {
    startDate: "2026-03-01",
    endDate: "2026-12-31",
    timeZone: "America/New_York",
  };

  it("projects timed events correctly through DST changes", () => {
    expect(
      occupiedDates(
        {
          kind: "timed",
          start: "2026-03-08T06:30:00.000Z",
          end: "2026-03-08T08:30:00.000Z",
        },
        range
      )
    ).toEqual(["2026-03-08"]);
    expect(
      occupiedDates(
        {
          kind: "timed",
          start: "2026-11-01T05:30:00.000Z",
          end: "2026-11-01T07:30:00.000Z",
        },
        range
      )
    ).toEqual(["2026-11-01"]);
  });

  it("treats all-day ends as exclusive", () => {
    expect(
      occupiedDates(
        {
          kind: "all-day",
          startDate: "2026-10-09",
          endDateExclusive: "2026-10-12",
        },
        range
      )
    ).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
  });

  it("places overnight events on both dates but excludes an exact-midnight end", () => {
    expect(
      occupiedDates(
        {
          kind: "timed",
          start: "2026-10-10T03:00:00.000Z",
          end: "2026-10-10T06:00:00.000Z",
        },
        range
      )
    ).toEqual(["2026-10-09", "2026-10-10"]);

    expect(
      occupiedDates(
        {
          kind: "timed",
          start: "2026-10-10T03:00:00.000Z",
          end: "2026-10-10T04:00:00.000Z",
        },
        range
      )
    ).toEqual(["2026-10-09"]);
  });

  it("clips overlaps to the requested range", () => {
    expect(
      occupiedDates(
        {
          kind: "all-day",
          startDate: "2026-09-29",
          endDateExclusive: "2026-10-04",
        },
        {
          startDate: "2026-10-01",
          endDate: "2026-10-02",
          timeZone: "UTC",
        }
      )
    ).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("crosses calendar years deterministically", () => {
    expect(
      occupiedDates(
        {
          kind: "all-day",
          startDate: "2026-12-31",
          endDateExclusive: "2027-01-02",
        },
        {
          startDate: "2026-12-30",
          endDate: "2027-01-02",
          timeZone: "UTC",
        }
      )
    ).toEqual(["2026-12-31", "2027-01-01"]);
  });
});

describe("shiftHistoricalRange", () => {
  it("clamps February 29 and applies a calendar-day buffer", () => {
    expect(
      shiftHistoricalRange(
        { startDate: "2024-02-29", endDate: "2024-03-02" },
        1,
        4
      )
    ).toEqual({ startDate: "2023-02-24", endDate: "2023-03-06" });
  });
});
