// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryPanel } from "./HistoryPanel";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("loads original history only on request and waits for a second explicit action before using AI", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          history: [
            {
              yearsBack: 1,
              coverage: { status: "complete" },
              events: [
                {
                  key: "a",
                  title: "Flight to Paris",
                  occupiedDates: ["2025-10-03"],
                  interval: {
                    kind: "all-day",
                    startDate: "2025-10-03",
                    endDateExclusive: "2025-10-04",
                  },
                  sources: [{ name: "Personal" }],
                  blocking: { countsAsConflict: true, moveable: false },
                  location: "Paris",
                },
                {
                  key: "b",
                  title: "Hotel in Paris",
                  occupiedDates: ["2025-10-03"],
                  interval: {
                    kind: "all-day",
                    startDate: "2025-10-03",
                    endDateExclusive: "2025-10-05",
                  },
                  sources: [{ name: "Personal" }],
                  blocking: { countsAsConflict: true, moveable: false },
                  location: "Paris",
                },
              ],
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          clusters: [
            {
              id: "c0",
              label: "Paris visit",
              emoji: "✈",
              startDate: "2025-10-03",
              endDate: "2025-10-03",
              eventIds: ["a", "b"],
            },
          ],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <HistoryPanel
      range={{
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        timeZone: "UTC",
      }}
      calendars={[{ id: "primary", name: "Personal" }]}
      calendarIds={["primary"]}
    />,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Load past calendar events" }),
  );
  const group = await screen.findByRole("button", {
    name: "Group related events with AI",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/calendar-history");
  await user.click(group);
  expect(await screen.findByText("Paris visit")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await user.click(screen.getByText("All original events (2)"));
  expect(screen.getByText("Flight to Paris")).toBeTruthy();
  expect(screen.getByText("Hotel in Paris")).toBeTruthy();
});
