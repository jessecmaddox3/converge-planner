import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceClientMocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceClient: serviceClientMocks.getSupabaseServiceClient,
}));

import { __resetMemoryRateLimits, consumeQuota } from "@/lib/rate-limit";

beforeEach(() => {
  serviceClientMocks.getSupabaseServiceClient.mockReset();
  serviceClientMocks.getSupabaseServiceClient.mockReturnValue(null);
});

describe("consumeQuota memory fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    __resetMemoryRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    __resetMemoryRateLimits();
  });

  it("allows requests through the limit and reports remaining capacity", async () => {
    const input = { actorKey: "actor-a", action: "advice", windowSeconds: 60, limit: 3 };

    await expect(consumeQuota(input)).resolves.toEqual({ allowed: true, remaining: 2, retryAfter: 0 });
    await expect(consumeQuota(input)).resolves.toEqual({ allowed: true, remaining: 1, retryAfter: 0 });
    await expect(consumeQuota(input)).resolves.toEqual({ allowed: true, remaining: 0, retryAfter: 0 });
  });

  it("rejects after the final allowed request and reports seconds to rollover", async () => {
    const input = { actorKey: "actor-a", action: "advice", windowSeconds: 60, limit: 1 };

    await expect(consumeQuota(input)).resolves.toEqual({ allowed: true, remaining: 0, retryAfter: 0 });
    await expect(consumeQuota(input)).resolves.toEqual({ allowed: false, remaining: 0, retryAfter: 50 });
  });

  it("isolates counters by actor and action", async () => {
    const base = { windowSeconds: 60, limit: 1 };

    await expect(consumeQuota({ ...base, actorKey: "actor-a", action: "advice" }))
      .resolves.toMatchObject({ allowed: true });
    await expect(consumeQuota({ ...base, actorKey: "actor-b", action: "advice" }))
      .resolves.toMatchObject({ allowed: true });
    await expect(consumeQuota({ ...base, actorKey: "actor-a", action: "history" }))
      .resolves.toMatchObject({ allowed: true });
    await expect(consumeQuota({ ...base, actorKey: "actor-a", action: "advice" }))
      .resolves.toMatchObject({ allowed: false });
  });

  it("isolates hourly and daily windows for the same actor and action", async () => {
    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 3600,
      limit: 1,
    })).resolves.toMatchObject({ allowed: true });
    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 86400,
      limit: 1,
    })).resolves.toMatchObject({ allowed: true });
  });

  it("starts a fresh counter at the next stable UTC epoch bucket", async () => {
    const input = { actorKey: "actor-a", action: "advice", windowSeconds: 60, limit: 1 };

    await expect(consumeQuota(input)).resolves.toMatchObject({ allowed: true });
    await expect(consumeQuota(input)).resolves.toMatchObject({ allowed: false, retryAfter: 50 });

    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));

    await expect(consumeQuota(input)).resolves.toEqual({ allowed: true, remaining: 0, retryAfter: 0 });
  });

  it.each([
    [{ actorKey: "actor", action: "advice", windowSeconds: 86401, limit: 1 }],
    [{ actorKey: "actor", action: "advice", windowSeconds: 60, limit: 10001 }],
  ])("rejects quota settings above practical bounds", async (input) => {
    await expect(consumeQuota(input)).rejects.toThrow("Invalid quota configuration");
  });
});

describe("consumeQuota production configuration", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when Vercel storage configuration is absent", async () => {
    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 1,
    })).rejects.toThrow("Quota storage unavailable");
  });

  it("sanitizes errors thrown by the shared service-client boundary", async () => {
    serviceClientMocks.getSupabaseServiceClient.mockImplementation(() => {
      throw new Error("sensitive configuration detail");
    });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 1,
    })).rejects.toThrow(/^Quota storage unavailable$/);
  });
});

describe("consumeQuota Supabase RPC", () => {
  function useRpcResult(result: unknown) {
    const rpc = vi.fn().mockResolvedValue(result);
    serviceClientMocks.getSupabaseServiceClient.mockReturnValue({ rpc });
    return rpc;
  }

  it("maps a valid single-row result and includes the window in the stable key", async () => {
    const rpc = useRpcResult({
      data: [{ allowed: true, remaining: 2, retry_after: 0 }],
      error: null,
    });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 3600,
      limit: 3,
    })).resolves.toEqual({ allowed: true, remaining: 2, retryAfter: 0 });
    expect(rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_key: "7:actor-a:advice:3600",
      p_window_seconds: 3600,
      p_limit: 3,
    });
  });

  it("fails closed on an RPC error result", async () => {
    useRpcResult({ data: null, error: { message: "database unavailable" } });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 3,
    })).rejects.toThrow("Quota storage unavailable");
  });

  it("fails closed when the RPC throws", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network failed"));
    serviceClientMocks.getSupabaseServiceClient.mockReturnValue({ rpc });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 3,
    })).rejects.toThrow("Quota storage unavailable");
  });

  it("rejects an allowed row whose remaining count equals the limit", async () => {
    useRpcResult({
      data: [{ allowed: true, remaining: 1, retry_after: 0 }],
      error: null,
    });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 1,
    })).rejects.toThrow("Quota storage unavailable");
  });

  it.each([
    ["null", null],
    ["empty", []],
    ["multiple", [
      { allowed: true, remaining: 2, retry_after: 0 },
      { allowed: true, remaining: 1, retry_after: 0 },
    ]],
  ])("fails closed on a %s RPC row set", async (_name, data) => {
    useRpcResult({ data, error: null });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 3,
    })).rejects.toThrow("Quota storage unavailable");
  });

  it.each([
    ["non-boolean allowed", { allowed: 1, remaining: 2, retry_after: 0 }],
    ["fractional remaining", { allowed: true, remaining: 1.5, retry_after: 0 }],
    ["non-finite remaining", { allowed: true, remaining: Number.NaN, retry_after: 0 }],
    ["negative remaining", { allowed: true, remaining: -1, retry_after: 0 }],
    ["remaining above limit", { allowed: true, remaining: 4, retry_after: 0 }],
    ["allowed result with retry", { allowed: true, remaining: 2, retry_after: 1 }],
    ["rejected result with remaining", { allowed: false, remaining: 1, retry_after: 20 }],
    ["rejected result without retry", { allowed: false, remaining: 0, retry_after: 0 }],
    ["fractional retry", { allowed: false, remaining: 0, retry_after: 1.5 }],
    ["retry above window", { allowed: false, remaining: 0, retry_after: 61 }],
  ])("fails closed on malformed RPC data: %s", async (_name, row) => {
    useRpcResult({ data: [row], error: null });

    await expect(consumeQuota({
      actorKey: "actor-a",
      action: "advice",
      windowSeconds: 60,
      limit: 3,
    })).rejects.toThrow("Quota storage unavailable");
  });
});
