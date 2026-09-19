import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  calendarList: vi.fn(),
  events: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    calendar: () => ({
      calendarList: { list: api.calendarList },
      events: { list: api.events },
    }),
  },
}));

import {
  GoogleCalendarFailure,
  MAX_CALENDARS,
  MAX_EVENTS_PER_CALENDAR,
  listAllCalendars,
  listAllEvents,
} from "@/lib/calendar/google";

describe("Google calendar pagination adapter", () => {
  beforeEach(() => {
    api.calendarList.mockReset();
    api.events.mockReset();
  });

  it("follows every calendar page token and maps complete sources", async () => {
    api.calendarList
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "primary",
              summary: "Primary",
              backgroundColor: "#111111",
              primary: true,
            },
          ],
          nextPageToken: "page-2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "shared",
              summary: "Shared",
              backgroundColor: "#222222",
            },
          ],
        },
      });

    const result = await listAllCalendars("token");

    expect(result).toMatchObject({ truncated: false, pageCount: 2 });
    expect(result.items).toEqual([
      { calendarId: "primary", name: "Primary", color: "#111111", primary: true },
      { calendarId: "shared", name: "Shared", color: "#222222", primary: false },
    ]);
    expect(api.calendarList.mock.calls[1][0]).toMatchObject({ pageToken: "page-2" });
  });

  it("follows an event token even when the preceding page is short", async () => {
    api.events
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "one" }],
          nextPageToken: "two",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "two" }],
          nextPageToken: "three",
        },
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: "three" }] },
      });

    const result = await listAllEvents(
      "token",
      "primary",
      {
        timeMin: "2026-10-01T00:00:00.000Z",
        timeMax: "2026-11-01T00:00:00.000Z",
        timeZone: "America/New_York",
      }
    );

    expect(result.items.map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(result.pageCount).toBe(3);
    expect(api.events.mock.calls[0][0]).toMatchObject({
      maxResults: 2500,
      singleEvents: true,
      showDeleted: false,
      orderBy: "startTime",
    });
  });

  it("rejects repeated page tokens", async () => {
    api.events
      .mockResolvedValueOnce({
        data: { items: [], nextPageToken: "repeat" },
      })
      .mockResolvedValueOnce({
        data: { items: [], nextPageToken: "repeat" },
      });

    await expect(
      listAllEvents("token", "primary", {
        timeMin: "2026-10-01T00:00:00.000Z",
        timeMax: "2026-11-01T00:00:00.000Z",
      })
    ).rejects.toMatchObject({
      name: "GoogleCalendarFailure",
      kind: "upstream",
    });
  });

  it.each([
    [401, "auth"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "upstream"],
  ])("sanitizes HTTP %s as %s", async (status, kind) => {
    api.events.mockRejectedValueOnce({
      response: { status, data: { private: "DO_NOT_EXPOSE" } },
      message: "DO_NOT_EXPOSE",
    });

    let failure: unknown;
    try {
      await listAllEvents("token", "primary", {
        timeMin: "2026-10-01T00:00:00.000Z",
        timeMax: "2026-11-01T00:00:00.000Z",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GoogleCalendarFailure);
    expect(failure).toMatchObject({ kind, status });
    expect(JSON.stringify(failure)).not.toContain("DO_NOT_EXPOSE");
  });

  it("classifies aborts as timeouts", async () => {
    const controller = new AbortController();
    controller.abort();
    api.events.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );

    await expect(
      listAllEvents(
        "token",
        "primary",
        {
          timeMin: "2026-10-01T00:00:00.000Z",
          timeMax: "2026-11-01T00:00:00.000Z",
        },
        controller.signal
      )
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("marks calendar and event caps as truncated", async () => {
    api.calendarList.mockResolvedValueOnce({
      data: {
        items: Array.from({ length: MAX_CALENDARS + 1 }, (_, index) => ({
          id: `calendar-${index}`,
          summary: `Calendar ${index}`,
        })),
      },
    });
    api.events.mockResolvedValueOnce({
      data: {
        items: Array.from({ length: MAX_EVENTS_PER_CALENDAR + 1 }, (_, index) => ({
          id: `event-${index}`,
        })),
      },
    });

    const calendars = await listAllCalendars("token");
    const events = await listAllEvents("token", "primary", {
      timeMin: "2026-10-01T00:00:00.000Z",
      timeMax: "2026-11-01T00:00:00.000Z",
    });

    expect(calendars).toMatchObject({ truncated: true });
    expect(calendars.items).toHaveLength(MAX_CALENDARS);
    expect(events).toMatchObject({ truncated: true });
    expect(events.items).toHaveLength(MAX_EVENTS_PER_CALENDAR);
  });
});
