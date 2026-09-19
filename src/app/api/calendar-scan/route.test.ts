import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const boundaries = vi.hoisted(() => ({
  authOptions: { test: "auth-options" },
  getToken: vi.fn(),
  getServerSession: vi.fn(),
  scanCalendars: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: boundaries.getServerSession,
}));

vi.mock("next-auth/jwt", () => ({
  getToken: boundaries.getToken,
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  authOptions: boundaries.authOptions,
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceClient: () => null,
}));

vi.mock("@/lib/calendar/scan", () => ({
  scanCalendars: boundaries.scanCalendars,
}));

import { resetJobCache } from "@/lib/cached-job";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { POST } from "@/app/api/calendar-scan/route";

function request(body: unknown, actor="organizer-actor"): NextRequest {
  return new NextRequest("http://localhost/api/calendar-scan", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Converge-Actor": actor },
    body: JSON.stringify(body),
  });
}

const validInput = {
  calendarIds: ["primary"],
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  timeZone: "America/New_York",
  historyPeriods: 1,
};

const completeResult = {
  current: {
    events: [],
    coverage: {
      status: "complete",
      requestedCalendarIds: ["primary"],
      successfulCalendarIds: ["primary"],
      failedCalendars: [],
      truncated: false,
    },
  },
  history: [],
  stats: {
    rawEvents: 0,
    normalizedEvents: 0,
    duplicateEvents: 0,
  },
};

describe("POST /api/calendar-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetJobCache();
    __resetMemoryRateLimits();
    boundaries.getServerSession.mockResolvedValue({
      user: { email: "organizer@example.com", actorId: "organizer-actor" },
    });
    boundaries.getToken.mockResolvedValue({
      accessToken: "google-token",
      expiresAt: Date.now() + 120000,
    });
    boundaries.scanCalendars.mockResolvedValue(completeResult);
  });

  it("requires an authenticated Google session", async () => {
    boundaries.getServerSession.mockResolvedValueOnce(null);

    const response = await POST(request(validInput, "anonymous"));

    expect(response.status).toBe(401);
    expect(boundaries.scanCalendars).not.toHaveBeenCalled();
  });

  it("requires a server-side Google token", async () => {
    boundaries.getToken.mockResolvedValueOnce(null);

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    expect(boundaries.scanCalendars).not.toHaveBeenCalled();
  });

  it("rejects invalid calendar counts before scanning", async () => {
    const response = await POST(request({ ...validInput, calendarIds: [] }));

    expect(response.status).toBe(400);
    expect(boundaries.scanCalendars).not.toHaveBeenCalled();
  });

  it("uses the server token and returns complete or partial scans with 200", async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(200);
    expect(boundaries.getServerSession).toHaveBeenCalledWith(
      boundaries.authOptions,
    );
    expect(boundaries.getToken).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.any(NextRequest),
      }),
    );
    expect(boundaries.scanCalendars).toHaveBeenCalledWith(
      validInput,
      "google-token",
    );
    expect(await response.json()).toEqual(completeResult);
  });

  it("returns 502 with structured coverage when every current calendar fails", async () => {
    boundaries.scanCalendars.mockResolvedValueOnce({
      ...completeResult,
      current: {
        events: [],
        coverage: {
          status: "failed",
          requestedCalendarIds: ["primary"],
          successfulCalendarIds: [],
          failedCalendars: [{ calendarId: "primary", reason: "upstream" }],
          truncated: false,
        },
      },
    });

    const response = await POST(request(validInput));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.current.coverage.status).toBe("failed");
  });
});
