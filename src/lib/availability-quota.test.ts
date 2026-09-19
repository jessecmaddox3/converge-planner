import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./supabase-server", () => ({ getSupabaseServiceClient: () => null }));
import { __resetMemoryRateLimits } from "./rate-limit";
import { enforceAvailabilityQuota } from "./availability-quota";
beforeEach(__resetMemoryRateLimits);
it("limits a shared trip even when a caller changes capability every time", async () => {
  for (let i = 0; i < 60; i++) await enforceAvailabilityQuota(new Request("http://localhost"), "trip", `guest-${i}`);
  await expect(enforceAvailabilityQuota(new Request("http://localhost"), "trip", "another-guest")).rejects.toMatchObject({ status: 429 });
});
it("limits rapid edits without permanently closing the invitation", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    for (let i = 0; i < 10; i++) await enforceAvailabilityQuota(new Request("http://localhost"), "trip", "guest");
    await expect(enforceAvailabilityQuota(new Request("http://localhost"), "trip", "guest")).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date("2026-10-01T12:01:01Z"));
    await expect(enforceAvailabilityQuota(new Request("http://localhost"), "trip", "guest")).resolves.toBeUndefined();
  } finally { vi.useRealTimers(); }
});
