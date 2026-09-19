// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OrganizerFlow from "./OrganizerFlow";
import { DRAFT_KEY, initialDraft, serializeDraft } from "@/lib/trip-draft";
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
beforeEach(() => {
  for (const key of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    Object.defineProperty(window, key, {
      configurable: true,
      value: {
        getItem: (name: string) => values.get(name) || null,
        setItem: (name: string, value: string) => values.set(name, value),
        removeItem: (name: string) => values.delete(name),
      },
    });
  }
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("finds real date options without Google or AI and restores an exact shortlist on reload", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(
    DRAFT_KEY,
    serializeDraft({
      ...initialDraft("2026-10-01"),
      name: "Mountains",
      endDate: "2026-10-31",
    }),
  );
  const first = render(<OrganizerFlow />);
  await user.click(await screen.findByRole("button", { name: /Find dates/ }));
  await screen.findByRole("heading", { name: "Your shortlist" });
  expect(fetch).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Add Oct 9 to Oct 11 to shortlist" }),
  );
  expect(
    screen.getByRole("button", { name: "Remove shortlisted Oct 9 to Oct 11" }),
  ).toBeTruthy();
  first.unmount();
  render(<OrganizerFlow />);
  expect(
    await screen.findByRole("button", {
      name: "Remove shortlisted Oct 9 to Oct 11",
    }),
  ).toBeTruthy();
  expect(screen.getAllByText("Calendar not checked.").length).toBeGreaterThan(
    0,
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("uses a native input date edit even when the browser does not emit change", async () => {
  window.localStorage.setItem(
    DRAFT_KEY,
    serializeDraft({
      ...initialDraft("2026-09-01"),
      name: "Mountains",
      endDate: "2026-12-31",
    }),
  );
  render(<OrganizerFlow />);
  const input = (await screen.findByLabelText(
    "Earliest departure",
  )) as HTMLInputElement;
  input.value = "2026-10-01";
  fireEvent.input(input);
  await userEvent.click(screen.getByRole("button", { name: /Find dates/ }));
  expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
});
