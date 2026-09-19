// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManageTrip from "@/components/converge/ManageTrip";
import MyTrips from "@/components/converge/MyTrips";
import {
  assignManagedTrip,
  manageTripPath,
} from "@/components/converge/trip-client";

const signInMock = vi.fn();
let sessionState: {
  status: "authenticated" | "unauthenticated" | "loading";
  data: { user?: { name?: string; email?: string } } | null;
};

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  useSession: () => sessionState,
}));

const collectingTrip = {
  id: "trip-123",
  name: "Blue Ridge Weekend",
  startDate: "2026-07-24",
  endDate: "2026-08-02",
  duration: 3,
  durationPreset: "weekend",
  notes: "Cabin and hiking",
  organizerName: "Quinn",
  organizerEmail: "quinn@example.com",
  selectedDates: ["2026-07-24", "2026-07-31"],
  responses: [
    {
      publicId: "response-a",
      name: "Alex",
      email: "alex@example.com",
      selectedDates: ["2026-07-24"],
      preferences: { "2026-07-24": "preferred" },
      conflictCount: 0,
      submittedAt: "2026-07-23T12:00:00.000Z",
    },
    {
      publicId: "response-b",
      name: "Sam",
      email: "",
      selectedDates: [],
      preferences: {},
      conflictCount: 2,
      submittedAt: "2026-07-23T13:00:00.000Z",
    },
  ],
  status: "collecting",
  confirmedDate: null,
  confirmedAt: null,
  confirmationVersion: 0,
  createdAt: "2026-07-23T10:00:00.000Z",
} as const;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("ManageTrip", () => {
  beforeEach(() => {
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Quinn", email: "quinn@example.com" } },
    };
    signInMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("refreshes pending email status after background delivery", async () => {
    vi.useFakeTimers();
    const trip = {
      ...collectingTrip,
      status: "confirmed",
      confirmedDate: "2026-07-24",
      confirmationVersion: 1,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          ...trip,
          notifications: { total: 1, pending: 1, sent: 0, failed: 0 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...trip,
          notifications: { total: 1, pending: 0, sent: 1, failed: 0 },
        }),
      );
    await act(async () => {
      render(<ManageTrip tripId="trip-123" />);
    });
    expect(screen.getByText(/Email delivery: 0 sent, 1 pending/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/Email delivery: 1 sent, 0 pending/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("redirects an unauthenticated organizer to Google sign-in", async () => {
    sessionState = { status: "unauthenticated", data: null };

    render(<ManageTrip tripId="trip-123" />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("google", {
        callbackUrl: expect.stringContaining("/manage/trip-123"),
      });
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the organizer dashboard and refreshes authoritative state", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(collectingTrip));
    const user = userEvent.setup();

    render(<ManageTrip tripId="trip-123" />);

    expect(
      await screen.findByRole("heading", { name: "Blue Ridge Weekend" }),
    ).toBeTruthy();
    expect(screen.getByText("2 responses")).toBeTruthy();
    expect(screen.getByText("2 of 3 available")).toBeTruthy();
    expect(screen.getByText("1 of 3 available")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Refresh responses" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/trips/trip-123/manage",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("confirms, retries the same date, displays confirmation, and reopens", async () => {
    const fetchMock = vi.mocked(fetch);
    const confirmedTrip = {
      ...collectingTrip,
      status: "confirmed",
      confirmedDate: "2026-07-24",
      confirmedAt: "2026-07-23T14:00:00.000Z",
      confirmationVersion: 1,
    } as const;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(collectingTrip))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          trip: confirmedTrip,
          confirmedDate: "2026-07-24",
          confirmationVersion: 1,
          alreadyConfirmed: false,
          notifications: { total: 1, sent: 0, pending: 1, failed: 0 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          trip: confirmedTrip,
          confirmedDate: "2026-07-24",
          confirmationVersion: 1,
          alreadyConfirmed: true,
          notifications: { total: 1, sent: 1, pending: 0, failed: 0 },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(collectingTrip));
    const user = userEvent.setup();

    render(<ManageTrip tripId="trip-123" />);

    await screen.findByRole("heading", { name: "Blue Ridge Weekend" });
    await user.click(screen.getByRole("button", { name: "Review Jul 24" }));
    expect(screen.getByText(/Cannot attend: Sam/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm Jul 24" }));

    expect(await screen.findByText("Trip confirmed")).toBeTruthy();
    expect(screen.getByText("Friday, July 24")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/trips/trip-123/confirmation",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ confirmedDate: "2026-07-24" }),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Check email delivery" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(/Delivery check queued/)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Reopen availability" }),
    );
    expect(
      await screen.findByRole("button", { name: "Review Jul 24" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/trips/trip-123/reopen",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("selects the most-attended date initially and preserves a deliberate selection on refresh", async () => {
    const trip = {
      ...collectingTrip,
      responses: [
        {
          ...collectingTrip.responses[0],
          selectedDates: ["2026-07-24", "2026-07-31"],
        },
        { ...collectingTrip.responses[1], selectedDates: ["2026-07-31"] },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(trip));
    const user = userEvent.setup();
    render(<ManageTrip tripId="trip-123" />);
    await screen.findByRole("table", { name: /Availability by person/ });
    expect(
      screen
        .getByRole("button", { name: "Choose Jul 31 to Aug 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(
      screen.getByRole("button", { name: "Choose Jul 24 to Jul 26" }),
    );
    await user.click(screen.getByRole("button", { name: "Refresh responses" }));
    await screen.findByText("Responses refreshed.");
    expect(
      screen
        .getByRole("button", { name: "Choose Jul 24 to Jul 26" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("surfaces the API error message and allows a retry", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "FORBIDDEN",
              message: "Only the organizer can manage this trip",
            },
          },
          403,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(collectingTrip));

    render(<ManageTrip tripId="trip-123" />);

    expect(
      await screen.findByText("Only the organizer can manage this trip"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Blue Ridge Weekend" }),
    ).toBeTruthy();
  });

  it("persists a required person and moves their unavailable option behind eligible dates", async () => {
    const planning = {
      revision: 0,
      requiredResponseIds: [],
      expectedPeople: [],
      invitationsClosed: false,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ...collectingTrip, planning }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...collectingTrip,
          planning: {
            ...planning,
            revision: 1,
            requiredResponseIds: ["response-a"],
          },
        }),
      );
    const user = userEvent.setup();
    render(<ManageTrip tripId="trip-123" />);
    await user.click(
      await screen.findByRole("checkbox", { name: "Require Alex" }),
    );
    await screen.findByText("Required person unavailable");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/trips/trip-123/planning",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          ...planning,
          requiredResponseIds: ["response-a"],
        }),
      }),
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Require Alex",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
});

describe("durable organizer navigation", () => {
  beforeEach(() => {
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Quinn", email: "quinn@example.com" } },
    };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("builds and assigns an encoded management route", () => {
    const location = { assign: vi.fn() };

    expect(manageTripPath("trip/a")).toBe("/manage/trip%2Fa");
    assignManagedTrip("trip/a", location);

    expect(location.assign).toHaveBeenCalledWith("/manage/trip%2Fa");
  });

  it("loads signed-in trips and links each role to its durable page", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        trips: [
          {
            id: "mine-1",
            name: "Organizer Trip",
            startDate: "2026-07-24",
            endDate: "2026-08-02",
            duration: 3,
            durationPreset: "weekend",
            status: "collecting",
            confirmedDate: null,
            confirmationVersion: 0,
            createdAt: "2026-07-23T10:00:00.000Z",
            role: "organizer",
          },
          {
            id: "joined-1",
            name: "Friend Trip",
            startDate: "2026-08-08",
            endDate: "2026-08-08",
            duration: 1,
            durationPreset: "day",
            status: "confirmed",
            confirmedDate: "2026-08-08",
            confirmationVersion: 1,
            createdAt: "2026-07-22T10:00:00.000Z",
            role: "respondent",
          },
        ],
      }),
    );

    render(<MyTrips />);

    expect(
      await screen.findByRole("heading", { name: "My Trips" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Organizer Trip/ }).getAttribute("href"),
    ).toBe("/manage/mine-1");
    expect(
      screen.getByRole("link", { name: /Friend Trip/ }).getAttribute("href"),
    ).toBe("/join/joined-1");
  });
});
