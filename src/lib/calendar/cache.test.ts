import { beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({
  scan: vi.fn(),
  history: vi.fn(),
  quota: vi.fn(),
}));
vi.mock("./scan", () => ({
  scanCalendars: provider.scan,
  scanCalendarHistory: provider.history,
}));
vi.mock("../supabase-server", () => ({ getSupabaseServiceClient: () => null }));
vi.mock("../rate-limit", () => ({ consumeQuota: provider.quota }));
import { resetJobCache } from "../cached-job";
import { cachedCalendarScan, scanCacheKey, parseScanRequest } from "./cache";
const input = {
  calendarIds: ["primary", "shared"],
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  timeZone: "America/New_York",
  historyPeriods: 0 as const,
};
const complete = {
  events: [],
  range: input,
  coverage: {
    status: "complete",
    requestedCalendarIds: input.calendarIds,
    successfulCalendarIds: input.calendarIds,
    failedCalendars: [],
    truncated: false,
  },
};
beforeEach(() => {
  resetJobCache();
  vi.clearAllMocks();
  provider.scan.mockResolvedValue({
    current: complete,
    history: [],
    stats: {},
  });
  provider.history.mockResolvedValue({ history: [complete], stats: {} });
  provider.quota.mockResolvedValue({ allowed: true });
});
describe("calendar cache", () => {
  it("includes actor, exact range, timezone, selected calendars and source metadata in the key", () => {
    expect(scanCacheKey("a", input)).toBe(
      scanCacheKey("a", { ...input, calendarIds: ["shared", "primary"] }),
    );
    for (const changed of [
      { endDate: "2026-11-01" },
      { timeZone: "UTC" },
      { calendarIds: ["primary"] },
      { calendarMetadata: { primary: { name: "Work", primary: true } } },
    ])
      expect(scanCacheKey("a", { ...input, ...changed })).not.toBe(
        scanCacheKey("a", input),
      );
    expect(scanCacheKey("b", input)).not.toBe(scanCacheKey("a", input));
  });
  it("reuses scans without Google or quota work and explicitly refreshes when requested", async () => {
    const token = vi.fn().mockResolvedValue("token");
    await cachedCalendarScan("a", input, token);
    expect((await cachedCalendarScan("a", input, token)).cacheHit).toBe(true);
    expect(token).toHaveBeenCalledTimes(1);
    expect(provider.quota).toHaveBeenCalledTimes(2);
    await cachedCalendarScan("a", { ...input, refresh: true }, token);
    expect(provider.scan).toHaveBeenCalledTimes(2);
  });
  it("does not cache partial results and fetches optional history independently", async () => {
    provider.scan.mockResolvedValue({
      current: {
        ...complete,
        coverage: { ...complete.coverage, status: "partial" },
      },
      history: [],
    });
    await cachedCalendarScan("a", input, async () => "token");
    await cachedCalendarScan("a", input, async () => "token");
    expect(provider.scan).toHaveBeenCalledTimes(2);
    await cachedCalendarScan(
      "a",
      { ...input, historyPeriods: 2 },
      async () => "token",
      true,
    );
    expect(provider.history).toHaveBeenCalledTimes(1);
    expect(provider.scan).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed refresh and metadata before provider work", () => {
    expect(() => parseScanRequest({ ...input, refresh: "yes" })).toThrow(
      "Invalid calendar scan request",
    );
    expect(() =>
      parseScanRequest({
        ...input,
        calendarMetadata: { primary: { name: 3 } },
      }),
    ).toThrow("Invalid calendar metadata");
  });
});
