// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowCard } from "@/components/converge/CalendarCards";

afterEach(cleanup);

const baseWindow = {
  start: "2026-04-17",
  end: "2026-04-19",
  conflict_score: 0,
  fixedCount: 0,
  highCount: 0,
  eventCount: 0,
  topConflict: null,
  windowEvents: [],
  historicalInsight: { byYear: {}, years: [], totalMatches: 0, seasonalInsights: [] },
  aiSeverity: "clear",
  summary: "No events scheduled, wide open",
  travelAdjacency: null,
};

const span = {
  startDate: "2026-04-05",
  endDate: "2026-04-11",
  label: "Away (NAS)",
  source: "flight-chain",
  confidence: "high",
};

function renderCard(travelAdjacency: unknown) {
  return render(
    <WindowCard
      window={{ ...baseWindow, travelAdjacency }}
      selected={false}
      onToggle={vi.fn()}
      rank={1}
      preset="weekend"
      conflictMap={{}}
      groupVotes={{}}
      isInvitee={false}
      connectedCalendars={[]}
      preference={null}
      histClusters={null}
    />
  );
}

describe("WindowCard travel adjacency line", () => {
  it("renders nothing when there is no nearby travel", () => {
    renderCard(null);

    expect(screen.queryByTestId("travel-adjacency")).toBeNull();
  });

  it("describes an overlapping trip", () => {
    renderCard({ severity: "overlapping", direction: "overlapping", gapDays: 0, span });

    expect(screen.getByTestId("travel-adjacency").textContent).toContain("overlaps this weekend");
  });

  it("describes landing the day before the window starts", () => {
    renderCard({ severity: "severe", direction: "before", gapDays: 0, span });

    expect(screen.getByTestId("travel-adjacency").textContent).toContain(
      "home the day before this starts"
    );
  });

  it("describes leaving the day after the window ends", () => {
    renderCard({ severity: "severe", direction: "after", gapDays: 0, span });

    expect(screen.getByTestId("travel-adjacency").textContent).toContain(
      "leaving the day after this ends"
    );
  });

  it("describes a gap in days and names the trip", () => {
    renderCard({ severity: "moderate", direction: "before", gapDays: 2, span });

    const text = screen.getByTestId("travel-adjacency").textContent || "";
    expect(text).toContain("2 days before");
    expect(text).toContain("Away (NAS)");
  });

  it("uses the singular for a one-day gap", () => {
    renderCard({ severity: "high", direction: "before", gapDays: 1, span });

    expect(screen.getByTestId("travel-adjacency").textContent).toContain("1 day before");
  });

  it("does not claim a direction for a span without directional evidence", () => {
    renderCard({
      severity: "severe",
      direction: "before",
      gapDays: 0,
      span: { ...span, label: "Travel day", confidence: "low" },
    });

    const text = screen.getByTestId("travel-adjacency").textContent || "";
    expect(text).toContain("the day before this starts");
    expect(text).not.toContain("home the day before");
  });

  it("still claims a direction for a high-confidence flight chain", () => {
    renderCard({
      severity: "severe",
      direction: "before",
      gapDays: 0,
      span: { ...span, source: "flight-chain", confidence: "high" },
    });

    expect(screen.getByTestId("travel-adjacency").textContent).toContain(
      "home the day before this starts"
    );
  });

  it("hides a low-confidence single-day span that only sits nearby", () => {
    renderCard({
      severity: "moderate",
      direction: "before",
      gapDays: 2,
      span: { ...span, startDate: "2026-04-11", endDate: "2026-04-11", confidence: "low" },
    });

    expect(screen.queryByTestId("travel-adjacency")).toBeNull();
  });

  it("still shows a low-confidence single-day span that overlaps the window", () => {
    renderCard({
      severity: "overlapping",
      direction: "overlapping",
      gapDays: 0,
      span: { ...span, startDate: "2026-04-18", endDate: "2026-04-18", confidence: "low" },
    });

    expect(screen.getByTestId("travel-adjacency")).toBeTruthy();
  });
});


it("does not claim an empty partial scan is wide open or best", () => {
  render(<WindowCard window={{ ...baseWindow, summary: "Calendar coverage is incomplete", aiSeverity: "unknown", coverage: { status: "partial", truncated: false } }} selected={false} onToggle={() => {}} rank={0} preset="weekend" conflictMap={{}} groupVotes={{}} isInvitee={false} connectedCalendars={[]} preference={null} histClusters={null} />);
  expect(screen.queryByText(/wide open/i)).toBeNull();
  expect(screen.queryByText(/best for you/i)).toBeNull();
});
