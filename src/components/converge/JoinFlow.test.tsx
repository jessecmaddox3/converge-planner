// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JoinFlow from "@/components/converge/JoinFlow";
import type { PublicTrip } from "@/lib/store";

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const STORAGE_KEY = "converge:respondent-capability:trip-123";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let sessionState: {
  status: "authenticated" | "unauthenticated" | "loading";
  data: { user?: { name?: string; email?: string } } | null;
};

const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  useSession: () => sessionState,
}));

const publicTrip: PublicTrip = {
  id: "trip-123",
  name: "Blue Ridge Weekend",
  startDate: "2026-07-24",
  endDate: "2026-08-02",
  duration: 3,
  durationPreset: "weekend",
  notes: "Cabin and hiking",
  organizerName: "Quinn",
  selectedDates: ["2026-07-24", "2026-07-31"],
  responses: [
    {
      publicId: "response-a",
      name: "Alex",
      selectedDates: ["2026-07-24"],
      preferences: { "2026-07-24": "preferred" },
      conflictCount: 0,
      submittedAt: "2026-07-23T12:00:00.000Z",
    },
    {
      publicId: "response-b",
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 1,
      submittedAt: "2026-07-23T13:00:00.000Z",
    },
  ],
  status: "collecting",
  confirmedDate: null,
  confirmedAt: null,
  confirmationVersion: 0,
  createdAt: "2026-07-23T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("JoinFlow", () => {
  let clipboardWrite: ReturnType<typeof vi.fn>;
  let storage: MemoryStorage;

  beforeEach(() => {
    sessionState = {
      status: "unauthenticated",
      data: null,
    };
    vi.stubGlobal("fetch", vi.fn());
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    window.history.replaceState({}, "", "/join/trip-123");
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("does not adopt someone else's stored response when a different account signs in", async () => {
    storage.setItem(STORAGE_KEY, TOKEN_A);
    storage.setItem("converge:join-private-identity:trip-123", "capability");
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Taylor", email: "taylor@example.com" } },
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ trip: publicTrip, role: "viewer", response: null }),
    );
    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);
    await screen.findByRole("textbox", { name: "Your name" });
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("prefills and updates a signed respondent without a capability header", async () => {
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Taylor", email: "taylor@example.com" } },
    };
    const ownResponse = {
      publicId: "mine",
      name: "Taylor Saved",
      selectedDates: ["2026-07-24"],
      preferences: { "2026-07-24": "preferred" },
      conflictCount: 3,
      submittedAt: "2026-07-23T14:00:00.000Z",
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          trip: publicTrip,
          role: "respondent",
          response: ownResponse,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          response: {
            ...ownResponse,
            selectedDates: ["2026-07-24", "2026-07-31"],
            preferences: {
              "2026-07-24": "preferred",
              "2026-07-31": "available",
            },
          },
        }),
      );
    const user = userEvent.setup();

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    expect(await screen.findByDisplayValue("Taylor Saved")).toBeTruthy();
    expect(screen.getByDisplayValue("taylor@example.com")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Favorite: Friday, July 24",
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Available: Friday, July 31",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Update availability" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/trips/trip-123/me",
      expect.objectContaining({ headers: headerFields({Authorization:null}) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/trips/trip-123/availability",
      expect.objectContaining({
        method: "PUT",
        headers: headerFields({ "Content-Type": "application/json", Authorization:null }),
        body: JSON.stringify({
          name: "Taylor Saved",
          selectedDates: ["2026-07-24", "2026-07-31"],
          preferences: {
            "2026-07-24": "preferred",
            "2026-07-31": "available",
          },
          conflictCount: 3,
          email: "taylor@example.com",
          answerVersion: 2,
          answers: { "2026-07-24": "available", "2026-07-31": "available" },
        }),
      }),
    );
    expect(
      await screen.findByText("Your availability is updated."),
    ).toBeTruthy();
  });

  it("captures an anonymous fragment, submits none-work, and copies a private return link", async () => {
    window.history.replaceState({}, "", `/join/trip-123#r=${TOKEN_A}`);
    const savedResponse = {
      publicId: "anonymous-response",
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      submittedAt: "2026-07-23T15:00:00.000Z",
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          trip: publicTrip,
          role: "viewer",
          response: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          response: savedResponse,
        }),
      );
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    const nameInput = await screen.findByRole("textbox", { name: "Your name" });
    await user.type(nameInput, "Alex");
    await user.click(screen.getByRole("button", { name: "None work for me" }));
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(window.location.hash).toBe("");
    expect(storage.getItem(STORAGE_KEY)).toBe(TOKEN_A);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/trips/trip-123/me",
      expect.objectContaining({
        headers: headerFields({ Authorization: `Capability ${TOKEN_A}` }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/trips/trip-123/availability",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "Alex",
          selectedDates: [],
          preferences: {},
          conflictCount: 0,
          email: "",
          answerVersion: 2,
          answers: { "2026-07-24": "unavailable", "2026-07-31": "unavailable" },
        }),
      }),
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Copy my private return link",
      }),
    );
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith(
        `http://localhost:3000/join/trip-123#r=${TOKEN_A}`,
      );
    });
  });

  it("includes a typed email address in the request body without blocking on name alone", async () => {
    const savedResponse = {
      publicId: "anonymous-response",
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      submittedAt: "2026-07-23T15:00:00.000Z",
      email: "alex@example.com",
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          trip: publicTrip,
          role: "viewer",
          response: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          response: savedResponse,
        }),
      );
    const user = userEvent.setup();

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    const nameInput = await screen.findByRole("textbox", { name: "Your name" });
    const emailInput = screen.getByRole("textbox", {
      name: /Email \(optional\)/,
    });
    expect(emailInput).toBeTruthy();
    await user.type(nameInput, "Alex");
    await user.type(emailInput, "alex@example.com");
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/trips/trip-123/availability",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "Alex",
          selectedDates: [],
          preferences: {},
          conflictCount: 0,
          email: "alex@example.com",
          answerVersion: 2,
          answers: {},
        }),
      }),
    );
    expect(await screen.findByText("Your availability is saved.")).toBeTruthy();
  });

  // The server rejects a malformed address with the shared INVALID_INPUT code, whose message
  // reads "Trip request is semantically invalid" — accurate but useless to an invitee who
  // mistyped a domain. The form checks first and says something actionable, so the request is
  // never sent. The server rejection remains as a backstop, covered in trip-validation.test.ts.
  it("explains a malformed email itself rather than sending it and relaying a generic error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        trip: publicTrip,
        role: "viewer",
        response: null,
      }),
    );
    const user = userEvent.setup();

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    const nameInput = await screen.findByRole("textbox", { name: "Your name" });
    const emailInput = screen.getByRole("textbox", {
      name: /Email \(optional\)/,
    });
    await user.type(nameInput, "Alex");
    await user.type(emailInput, "brett@gmial");
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    expect(await screen.findByText(/does not look right/i)).toBeTruthy();
    expect(
      screen.queryByText("Trip request is semantically invalid"),
    ).toBeNull();
    // Only the initial viewer-state load. The save was never attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still saves when the email is cleared, since it is optional", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          trip: publicTrip,
          role: "viewer",
          response: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          response: {
            publicId: "anonymous-response",
            name: "Alex",
            selectedDates: [],
            preferences: {},
            conflictCount: 0,
            submittedAt: "2026-07-23T15:00:00.000Z",
          },
        }),
      );
    const user = userEvent.setup();

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    const nameInput = await screen.findByRole("textbox", { name: "Your name" });
    await user.type(nameInput, "Alex");
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/does not look right/i)).toBeNull();
  });

  it("restores a same-browser response and keeps same-name respondents separate", async () => {
    storage.setItem(STORAGE_KEY, TOKEN_B);
    const ownResponse = {
      publicId: "response-a",
      name: "Alex",
      selectedDates: ["2026-07-24"],
      preferences: { "2026-07-24": "preferred" },
      conflictCount: 0,
      submittedAt: "2026-07-23T12:00:00.000Z",
    };
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        trip: publicTrip,
        role: "respondent",
        response: ownResponse,
      }),
    );

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    expect(await screen.findByDisplayValue("Alex")).toBeTruthy();
    expect(screen.getAllByText("Alex")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Available:/ })).toHaveLength(
      2,
    );
    expect(screen.queryByText("Saturday, July 25")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: /Email \(optional\)/ }),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/trips/trip-123/me",
      expect.objectContaining({
        headers: headerFields({ Authorization: `Capability ${TOKEN_B}` }),
      }),
    );
  });

  it("shows a confirmed trip as read-only", async () => {
    storage.setItem(STORAGE_KEY, TOKEN_A);
    const confirmedTrip = {
      ...publicTrip,
      status: "confirmed",
      confirmedDate: "2026-07-24",
      confirmedAt: "2026-07-23T16:00:00.000Z",
      confirmationVersion: 1,
    } as const;
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        trip: confirmedTrip,
        role: "respondent",
        response: publicTrip.responses[0],
      }),
    );

    render(<JoinFlow tripId="trip-123" initialTrip={confirmedTrip} />);

    expect(await screen.findByText("Trip confirmed")).toBeTruthy();
    expect(screen.getByText("Friday, July 24")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /availability/i })).toBeNull();
  });

  it("hands an organizer on the join URL back to the management page", async () => {
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Quinn", email: "quinn@example.com" } },
    };
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        trip: publicTrip,
        role: "organizer",
        response: null,
      }),
    );

    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);

    const manageLink = await screen.findByRole("link", { name: "Manage trip" });
    expect(manageLink.getAttribute("href")).toBe("/manage/trip-123");
    expect(
      screen.queryByRole("button", { name: "Save availability" }),
    ).toBeNull();
  });
  it("saves a partial Maybe answer without turning an unanswered option into Cannot", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ trip: publicTrip, role: "viewer", response: null }),
    );
    fetchMock.mockImplementationOnce(async (_url, init) =>
      jsonResponse({
        response: {
          ...JSON.parse(String(init?.body)),
          publicId: "new-response",
          submittedAt: "2026-07-23T12:00:00Z",
        },
      }),
    );
    const user = userEvent.setup();
    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);
    await user.type(
      await screen.findByRole("textbox", { name: "Your name" }),
      "Casey",
    );
    expect(screen.queryByText("Who has weighed in")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Maybe: Friday, July 24" }),
    );
    await user.click(screen.getByRole("button", { name: "Save availability" }));
    expect(await screen.findByText("Your availability is saved.")).toBeTruthy();
    const savedBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(savedBody).toMatchObject({
      answerVersion: 2,
      answers: { "2026-07-24": "maybe" },
      selectedDates: [],
    });
    expect(Object.keys(savedBody.answers)).toEqual(["2026-07-24"]);
    expect(screen.getByText("1 of 2 answered")).toBeTruthy();
    expect(screen.getByText("Unanswered")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Maybe: Friday, July 24" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("preserves private identity and unfinished answers through calendar sign-in, then keeps conflicts private", async () => {
    storage.setItem(STORAGE_KEY, TOKEN_A);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ trip: publicTrip, role: "viewer", response: null }),
    );
    const user = userEvent.setup();
    const first = render(
      <JoinFlow tripId="trip-123" initialTrip={publicTrip} />,
    );
    await user.type(
      await screen.findByRole("textbox", { name: "Your name" }),
      "Alex",
    );
    await user.click(
      screen.getByRole("button", { name: "Maybe: Friday, July 24" }),
    );
    await user.click(screen.getByText("Check my calendar"));
    await user.click(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    );
    expect(signInMock).toHaveBeenCalledWith("google", expect.any(Object));
    first.unmount();
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Google Name", email: "account@example.com" } },
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ trip: publicTrip, role: "viewer", response: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: "primary", name: "My calendar", primary: true }]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          current: {
            events: [
              {
                key: "wedding",
                title: "Private wedding",
                interval: {
                  kind: "timed",
                  start: "2026-07-24T18:00:00Z",
                  end: "2026-07-24T20:00:00Z",
                },
                occupiedDates: ["2026-07-24"],
                durationMinutes: 120,
                sources: [
                  { calendarId: "primary", name: "My calendar", primary: true },
                ],
                blocking: {
                  countsAsConflict: true,
                  moveable: false,
                  severity: "high",
                  reason: "Fixed commitment",
                },
              },
            ],
            coverage: {
              status: "complete",
              requestedCalendarIds: ["primary"],
              successfulCalendarIds: ["primary"],
              failedCalendars: [],
              truncated: false,
            },
          },
          history: [],
        }),
      );
    render(<JoinFlow tripId="trip-123" initialTrip={publicTrip} />);
    expect(await screen.findByDisplayValue("Alex")).toBeTruthy();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/calendars",
        expect.any(Object),
      ),
    );
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe(`Capability ${TOKEN_A}`);
    await user.click(screen.getByText("Check my calendar"));
    await user.click(
      screen.getByRole("button", { name: "Check selected calendars" }),
    );
    expect(
      await screen.findByText("1 likely fixed commitment to review."),
    ).toBeTruthy();
    await user.click(screen.getByText("See your events"));
    expect(screen.getByText("Private wedding")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Maybe: Friday, July 24" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Unanswered")).toBeTruthy();
    expect(screen.queryByText("Who has weighed in")).toBeNull();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "summarize-history",
    );
  });
});

function headerFields(expected: Record<string,string|null>) {
  return {asymmetricMatch(received: HeadersInit) {const headers=new Headers(received);return Object.entries(expected).every(([key,value])=>headers.get(key)===value);}};
}
