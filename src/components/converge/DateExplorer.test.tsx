// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRecommendedWindows } from "@/lib/analysis";
import { DateExplorer } from "./DateExplorer";
afterEach(cleanup);
it("keeps 91 exact options reachable through bounded family disclosure and toggles the requested variant", async () => {
  const windows = generateRecommendedWindows(
    "2026-10-01",
    "2027-01-02",
    4,
    "custom",
    [],
    [],
  );
  expect(windows).toHaveLength(91);
  const toggle = vi.fn();
  const user = userEvent.setup();
  render(
    <DateExplorer
      windows={windows}
      selected={[]}
      focused="2026-10-01"
      onFocus={vi.fn()}
      onToggle={toggle}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Inspect Dec 30 to Jan 2" }),
  ).toBeNull();
  while (screen.queryByRole("button", { name: /Show more date groups/ }))
    await user.click(
      screen.getByRole("button", { name: /Show more date groups/ }),
    );
  const summaries = screen.getAllByText(/nearby alternative/);
  for (const summary of summaries) await user.click(summary);
  expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(91);
  await user.click(
    screen.getByRole("button", { name: "Add Oct 2 to Oct 5 to shortlist" }),
  );
  expect(toggle).toHaveBeenCalledWith("2026-10-02");
});
