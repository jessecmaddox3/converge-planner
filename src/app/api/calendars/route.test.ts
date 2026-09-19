import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const googleMocks = vi.hoisted(() => ({
  calendarList: vi.fn(),
  getToken: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({getServerSession:googleMocks.getServerSession}));

vi.mock("next-auth/jwt", () => ({
  getToken: googleMocks.getToken,
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    calendar: () => ({
      calendarList: { list: googleMocks.calendarList },
    }),
  },
}));

import { GET } from "@/app/api/calendars/route";

describe("GET /api/calendars", () => {
  beforeEach(() => {
    googleMocks.getServerSession.mockReset();
    googleMocks.getServerSession.mockResolvedValue({user:{actorId:"account:calendar"}});
    googleMocks.calendarList.mockReset();
    googleMocks.getToken.mockReset();
    googleMocks.getToken.mockResolvedValue({
      accessToken: "server-token",
      expiresAt: Date.now() + 120000,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("rejects an old tab before accessing or refreshing any provider token", async () => {
    googleMocks.getServerSession.mockResolvedValue({user:{actorId:'account:new'}});
    const response=await GET(new NextRequest('http://localhost/api/calendars',{headers:{'X-Converge-Actor':'account:old'}}));
    expect(response.status).toBe(409);
    expect(googleMocks.getToken).not.toHaveBeenCalled();
    expect(googleMocks.calendarList).not.toHaveBeenCalled();
  });
  it("refreshes an expired Google token before listing calendars", async () => {
    googleMocks.getToken.mockResolvedValueOnce({
      accessToken: "old-token",
      refreshToken: "refresh-test",
      expiresAt: 1,
    });
    const refresh = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", refresh);
    googleMocks.calendarList.mockResolvedValueOnce({ data: { items: [] } });
    const response = await GET(
      new NextRequest("http://localhost/api/calendars",{headers:{"X-Converge-Actor":"account:calendar"}}),
    );
    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await response.json()).toEqual([]);
  });

  it("uses the server JWT and returns every page", async () => {
    googleMocks.calendarList
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "primary", summary: "Primary", primary: true }],
          nextPageToken: "page-2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: "shared", summary: "Shared", backgroundColor: "#123456" },
          ],
        },
      });

    const request = new NextRequest("http://localhost/api/calendars",{headers:{"X-Converge-Actor":"account:calendar"}});
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(googleMocks.getToken).toHaveBeenCalledWith(
      expect.objectContaining({
        req: request,
      }),
    );
    expect(await response.json()).toEqual([
      { id: "primary", name: "Primary", color: "#4285F4", primary: true },
      { id: "shared", name: "Shared", color: "#123456", primary: false },
    ]);
  });

  it("rejects requests without a server-side Google token", async () => {
    googleMocks.getToken.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest("http://localhost/api/calendars",{headers:{"X-Converge-Actor":"account:calendar"}}),
    );

    expect(response.status).toBe(401);
    expect(googleMocks.calendarList).not.toHaveBeenCalled();
  });

  it("does not expose provider failures", async () => {
    googleMocks.calendarList.mockRejectedValueOnce(
      new Error("PRIVATE_PROVIDER_DETAIL"),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/calendars",{headers:{"X-Converge-Actor":"account:calendar"}}),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to fetch calendars" });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });
});
