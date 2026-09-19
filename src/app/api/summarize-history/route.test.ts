import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const boundaryMocks = vi.hoisted(() => ({
  authOptions: { test: "auth-options" },
  consumeQuota: vi.fn(),
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
  getServerSession: vi.fn(),
  providerFetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: boundaryMocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: boundaryMocks.authOptions,
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeQuota: boundaryMocks.consumeQuota,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: boundaryMocks.generateContent };
  },
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceClient: () => null,
}));

import { resetJobCache } from "@/lib/cached-job";
import { resetAIBudget } from "@/lib/ai-budget";
import { POST } from "@/app/api/summarize-history/route";

interface TestEvent {
  id: string;
  title: string;
  date: string;
  calendar?: string;
  location?: string;
  duration?: string;
}

function request(body: string, contentType = "application/json", actor="account:actor-123"): NextRequest {
  return new NextRequest("https://converge.test/api/summarize-history", {
    method: "POST",
    headers: { "content-type": contentType, "X-Converge-Actor": actor },
    body,
  });
}

function eventsRequest(events: TestEvent[], actor="account:actor-123"): NextRequest {
  return request(JSON.stringify({ events }), "application/json", actor);
}

function validEvents(count = 2): TestEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    title: `Event ${index}`,
    date: "2026-07-23",
    calendar: "Personal",
    location: "Alder Quay",
    duration: "1 hour",
  }));
}

function aggregateUserChars(events: TestEvent[]): number {
  return events.reduce(
    (total, event) =>
      total +
      Object.values(event).reduce(
        (eventTotal, value) =>
          eventTotal + (typeof value === "string" ? value.length : 0),
        0,
      ),
    0,
  );
}

function eventsWithAggregateChars(target: number): TestEvent[] {
  const events = validEvents();
  const current = aggregateUserChars(events);
  events[0].title += "x".repeat(target - current);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetJobCache();
  resetAIBudget();
  vi.stubEnv("ACTOR_KEY_SECRET", "actor-test-secret");
  vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
  vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
  boundaryMocks.getServerSession.mockResolvedValue({
    user: { actorId: "account:actor-123" },
    expires: "2099-01-01T00:00:00.000Z",
  });
  boundaryMocks.consumeQuota.mockResolvedValue({
    allowed: true,
    remaining: 1,
    retryAfter: 0,
  });
  boundaryMocks.providerFetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: '{"clusters":[]}' }],
        model: "claude-sonnet-5",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", boundaryMocks.providerFetch);
  boundaryMocks.generateContent.mockResolvedValue({
    text: '{"clusters":[]}',
  });
  boundaryMocks.getGenerativeModel.mockReturnValue({
    generateContent: boundaryMocks.generateContent,
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/summarize-history", () => {
  it("returns 401 and suppresses quota and provider calls without a session", async () => {
    boundaryMocks.getServerSession.mockResolvedValueOnce(null);

    const response = await POST(eventsRequest(validEvents(), "anonymous"));

    expect(response.status).toBe(401);
    expect(boundaryMocks.getServerSession).toHaveBeenCalledWith(
      boundaryMocks.authOptions,
    );
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns 401 for a stale pre-actor session when the actor secret is configured", async () => {
    boundaryMocks.getServerSession.mockResolvedValueOnce({
      user: { email: "quinn@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    });

    const response = await POST(eventsRequest(validEvents(), "anonymous"));

    expect(response.status).toBe(401);
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns a sanitized 503 for an authenticated session when the actor secret is missing", async () => {
    vi.stubEnv("ACTOR_KEY_SECRET", "");
    boundaryMocks.getServerSession.mockResolvedValueOnce({
      user: { email: "quinn@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    });

    const response = await POST(eventsRequest(validEvents(), "anonymous"));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("ACTOR_KEY_SECRET");
    expect(text).toContain("Internal server error");
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "uses the wrong content type",
      makeRequest: () => request("{}", "text/plain"),
      status: 415,
    },
    {
      label: "contains malformed JSON",
      makeRequest: () => request('{"events":'),
      status: 400,
    },
    {
      label: "exceeds the explicit body byte cap",
      makeRequest: () =>
        request(JSON.stringify({ padding: "x".repeat(70_000) })),
      status: 413,
    },
  ])(
    "rejects a request that $label with $status",
    async ({ makeRequest, status }) => {
      const response = await POST(makeRequest());

      expect(response.status).toBe(status);
      expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
      expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    },
  );

  it("accepts exactly 120 events and applies exact quotas and output limit", async () => {
    const response = await POST(eventsRequest(validEvents(120)));

    expect(response.status).toBe(200);
    expect(boundaryMocks.consumeQuota.mock.calls).toEqual([
      [
        {
          actorKey: "account:actor-123",
          action: "ai-history-summary",
          windowSeconds: 3_600,
          limit: 4,
        },
      ],
      [
        {
          actorKey: "account:actor-123",
          action: "ai-history-summary",
          windowSeconds: 86_400,
          limit: 10,
        },
      ],
    ]);
    expect(boundaryMocks.generateContent).toHaveBeenCalledTimes(1);
    expect(boundaryMocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.5-flash-lite",
        config: expect.objectContaining({
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        }),
      }),
    );
  });

  it("rejects 121 events before quota or provider calls", async () => {
    const response = await POST(eventsRequest(validEvents(121)));

    expect(response.status).toBe(400);
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate input IDs before quota or provider calls", async () => {
    const duplicate = validEvents();
    duplicate[1].id = duplicate[0].id;

    const response = await POST(eventsRequest(duplicate));

    expect(response.status).toBe(400);
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
  });

  it("accepts exactly 20,000 aggregate user-controlled characters", async () => {
    const events = eventsWithAggregateChars(20_000);
    expect(aggregateUserChars(events)).toBe(20_000);

    const response = await POST(eventsRequest(events));

    expect(response.status).toBe(200);
    expect(boundaryMocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects 20,001 aggregate user-controlled characters before quota or provider calls", async () => {
    const events = eventsWithAggregateChars(20_001);
    expect(aggregateUserChars(events)).toBe(20_001);

    const response = await POST(eventsRequest(events));

    expect(response.status).toBe(400);
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After and suppresses providers when quota is exhausted", async () => {
    boundaryMocks.consumeQuota.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 91,
    });

    const response = await POST(eventsRequest(validEvents()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("91");
    expect(boundaryMocks.consumeQuota).toHaveBeenCalledTimes(1);
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it("uses the daily Retry-After and suppresses providers when the second quota rejects", async () => {
    boundaryMocks.consumeQuota
      .mockResolvedValueOnce({ allowed: true, remaining: 3, retryAfter: 0 })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfter: 1_803,
      });

    const response = await POST(eventsRequest(validEvents()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1803");
    expect(boundaryMocks.consumeQuota).toHaveBeenCalledTimes(2);
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it("sanitizes second-window quota-storage failures and suppresses providers", async () => {
    boundaryMocks.consumeQuota
      .mockResolvedValueOnce({ allowed: true, remaining: 3, retryAfter: 0 })
      .mockRejectedValueOnce(new Error("daily SUPABASE_SECRET detail"));

    const response = await POST(eventsRequest(validEvents()));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("SUPABASE_SECRET");
    expect(text).toContain("Internal server error");
    expect(boundaryMocks.consumeQuota).toHaveBeenCalledTimes(2);
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it("sanitizes quota-storage failures and suppresses providers", async () => {
    boundaryMocks.consumeQuota.mockRejectedValueOnce(
      new Error("SUPABASE_SERVICE_ROLE_KEY leaked"),
    );

    const response = await POST(eventsRequest(validEvents()));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(text).toContain("Internal server error");
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
    expect(boundaryMocks.generateContent).not.toHaveBeenCalled();
  });

  it("sanitizes missing provider configuration", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");

    const response = await POST(eventsRequest(validEvents()));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("ANTHROPIC_API_KEY");
    expect(text).not.toContain("GEMINI_API_KEY");
    expect(text).toContain("Internal server error");
    expect(boundaryMocks.consumeQuota).not.toHaveBeenCalled();
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures", async () => {
    boundaryMocks.generateContent.mockRejectedValueOnce(
      new Error("provider-secret-detail"),
    );

    const response = await POST(eventsRequest(validEvents()));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("provider-secret-detail");
    expect(text).not.toContain("Anthropic");
    expect(text).toContain("Internal server error");
    expect(boundaryMocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not treat an empty Gemini body as a successful empty-cluster response", async () => {
    // Regression pin: a thinking model can burn its whole output budget on
    // reasoning and return "" without throwing. That must not be accepted as
    // a legitimate {"clusters":[]} result.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    boundaryMocks.generateContent.mockResolvedValue({
      text: "",
    });

    const response = await POST(eventsRequest(validEvents()));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain("Internal server error");
    expect(boundaryMocks.generateContent).toHaveBeenCalledTimes(1);
    expect(boundaryMocks.providerFetch).not.toHaveBeenCalled();
  });
});
