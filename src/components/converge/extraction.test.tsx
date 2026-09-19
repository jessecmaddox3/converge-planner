// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "@/components/converge/CalendarCards";
import { Spinner, ToastContainer } from "@/components/converge/Feedback";
import { DebugDrawer } from "@/components/converge/DebugTools";
import { logger } from "@/lib/client-logger";

afterEach(cleanup);

describe("bounded Converge component extraction", () => {
  it("renders the extracted calendar boundary", () => {
    render(
      <CalendarView
        startDate="2026-10-01"
        endDate="2026-10-02"
        events={[]}
        duration={1}
        preset="day"
        selectedDates={[]}
        onToggleDate={vi.fn()}
        recommendedWindows={[
          { start: "2026-10-01", end: "2026-10-01" },
          { start: "2026-10-02", end: "2026-10-02" },
        ]}
      />
    );

    expect(screen.getByText("October 2026")).toBeTruthy();
  });

  it("shows a canonical multi-day event on every occupied calendar date", () => {
    const view = render(
      <CalendarView
        startDate="2026-10-01"
        endDate="2026-10-02"
        events={[
          {
            key: "uid-1",
            title: "Overnight trip",
            date: "2026-10-01",
            occupiedDates: ["2026-10-01", "2026-10-02"],
            countsAsConflict: true,
            importance_score: 7,
            moveable: false,
          },
        ]}
        duration={1}
        preset="day"
        selectedDates={[]}
        onToggleDate={vi.fn()}
        recommendedWindows={[
          { start: "2026-10-01", end: "2026-10-01" },
          { start: "2026-10-02", end: "2026-10-02" },
        ]}
      />
    );

    fireEvent.mouseEnter(view.getByText("2"));
    expect(view.getByText("Overnight trip")).toBeTruthy();
  });

  it("renders extracted feedback and keeps the closed debug drawer inert", () => {
    const { container } = render(
      <>
        <Spinner />
        <ToastContainer
          toasts={[{ id: 1, type: "success", message: "Saved" }]}
          onDismiss={vi.fn()}
        />
        <DebugDrawer isOpen={false} onClose={vi.fn()} />
      </>
    );

    expect(screen.getByText("Saved")).toBeTruthy();
    expect(container.textContent).not.toContain("Debug Console");
  });

  it("shares one extracted client logger instance", () => {
    expect(logger.getSessionInfo().sessionId).toMatch(/^[a-z0-9]+$/);
  });
});
