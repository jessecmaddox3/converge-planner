// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCoverage from "@/components/converge/CalendarCoverage";
import type { ScanCoverage } from "@/lib/calendar/types";

afterEach(cleanup);

function coverage(overrides: Partial<ScanCoverage> = {}): ScanCoverage {
  return {
    status: "complete",
    requestedCalendarIds: ["primary"],
    successfulCalendarIds: ["primary"],
    failedCalendars: [],
    truncated: false,
    ...overrides,
  };
}

describe("CalendarCoverage", () => {
  it("shows all clear only for complete empty data", () => {
    const { rerender } = render(
      <CalendarCoverage coverage={coverage()} eventCount={0} />
    );
    expect(screen.getByText("All clear across loaded calendars")).toBeTruthy();

    rerender(
      <CalendarCoverage
        coverage={coverage({ status: "partial" })}
        eventCount={0}
      />
    );
    expect(screen.queryByText("All clear across loaded calendars")).toBeNull();
  });

  it("labels partial recommendations and names failed calendars", () => {
    render(
      <CalendarCoverage
        coverage={coverage({
          status: "partial",
          requestedCalendarIds: ["primary", "family"],
          failedCalendars: [
            { calendarId: "family", name: "Family", reason: "forbidden" },
          ],
        })}
        eventCount={3}
      />
    );

    expect(screen.getByText("Best among loaded calendars")).toBeTruthy();
    expect(screen.getByText(/Family/)).toBeTruthy();
  });

  it("shows a persistent truncation warning", () => {
    render(
      <CalendarCoverage
        coverage={coverage({ truncated: true })}
        eventCount={0}
      />
    );

    expect(screen.getByText(/Calendar results were limited/)).toBeTruthy();
    expect(screen.queryByText("All clear across loaded calendars")).toBeNull();
  });

  it("shows failed coverage with a retry action", () => {
    const onRetry = vi.fn();
    render(
      <CalendarCoverage
        coverage={coverage({
          status: "failed",
          successfulCalendarIds: [],
          failedCalendars: [
            { calendarId: "primary", name: "Primary", reason: "upstream" },
          ],
        })}
        eventCount={0}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText("Calendar scan failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry scan" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps historical incompleteness visible", () => {
    render(
      <CalendarCoverage
        coverage={coverage()}
        eventCount={2}
        historicalCoverages={[
          coverage({
            status: "partial",
            failedCalendars: [
              { calendarId: "family", name: "Family", reason: "forbidden" },
            ],
          }),
        ]}
      />
    );

    expect(screen.getByText("Historical calendar data is incomplete")).toBeTruthy();
  });
});
