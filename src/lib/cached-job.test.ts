import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./supabase-server", () => ({ getSupabaseServiceClient: () => null }));
import { cachedJob, resetJobCache } from "./cached-job";
beforeEach(resetJobCache);
afterEach(() => vi.useRealTimers());
describe("private job cache", () => {
  it("reuses a valid empty result, isolates actors, and bypasses a completed result on explicit refresh", async () => {
    const generate = vi.fn().mockResolvedValue([]);
    const options = { ttlSeconds: 300, leaseSeconds: 30, generate };
    expect(await cachedJob("actor-a:scan", options)).toEqual({
      value: [],
      cacheHit: false,
    });
    expect(await cachedJob("actor-a:scan", options)).toEqual({
      value: [],
      cacheHit: true,
    });
    await cachedJob("actor-b:scan", options);
    await cachedJob("actor-a:scan", { ...options, refresh: true });
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it("deduplicates concurrent requests with a retryable state and releases failed leases", async () => {
    let finish!: (value: string[]) => void;
    const generate = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    const options = { ttlSeconds: 300, leaseSeconds: 30, generate };
    const first = cachedJob("a", options);
    await Promise.resolve();
    await expect(cachedJob("a", options)).rejects.toMatchObject({
      code: "CACHE_PENDING",
      status: 409,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    finish(["result"]);
    await first;
    await expect(
      cachedJob("b", {
        ...options,
        generate: async () => {
          throw new Error("provider failed");
        },
      }),
    ).rejects.toThrow("provider failed");
    expect(
      await cachedJob("b", { ...options, generate: async () => "retry" }),
    ).toMatchObject({ value: "retry", cacheHit: false });
  });
  it("expires results and prevents a stale worker from overwriting a newer lease", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const pending = cachedJob("a", {
      ttlSeconds: 10,
      leaseSeconds: 1,
      generate: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1001);
    await cachedJob("a", {
      ttlSeconds: 10,
      leaseSeconds: 1,
      generate: async () => "new",
    });
    finish("stale");
    await expect(pending).resolves.toMatchObject({
      value: "stale",
      cacheHit: false,
    });
    expect(
      await cachedJob("a", {
        ttlSeconds: 10,
        leaseSeconds: 1,
        generate: async () => "unused",
      }),
    ).toMatchObject({ value: "new", cacheHit: true });
    await vi.advanceTimersByTimeAsync(10001);
    expect(
      await cachedJob("a", {
        ttlSeconds: 10,
        leaseSeconds: 1,
        generate: async () => "fresh",
      }),
    ).toMatchObject({ value: "fresh", cacheHit: false });
  });
});
