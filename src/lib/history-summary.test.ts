import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ generate: vi.fn(), quota: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: provider.generate };
  },
}));
vi.mock("./supabase-server", () => ({ getSupabaseServiceClient: () => null }));
vi.mock("./rate-limit", () => ({ consumeQuota: provider.quota }));
import { resetJobCache } from "./cached-job";
import { resetAIBudget } from "./ai-budget";
import { summarizeHistory, historyCacheKey } from "./history-summary";
const events = [
  { id: "a", title: "Flight", date: "2026-07-01", location: "Paris" },
  { id: "b", title: "Hotel", date: "2026-07-02", location: "Paris" },
];
beforeEach(() => {
  resetJobCache();
  resetAIBudget();
  vi.clearAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "test");
  provider.generate.mockResolvedValue({
    text: '{"clusters":[]}',
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 10 },
    candidates: [{ finishReason: "STOP" }],
  });
  provider.quota.mockResolvedValue({ allowed: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("history result reuse", () => {
  it("reuses reordered input and valid empty clusters without quota or provider calls", async () => {
    await summarizeHistory("a", events, "UTC");
    expect(
      await summarizeHistory("a", [...events].reverse(), "UTC"),
    ).toMatchObject({ clusters: [], cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.quota).toHaveBeenCalledTimes(2);
  });
  it("invalidates on edits, deletion, timezone or actor changes", () => {
    const key = historyCacheKey("a", events, "UTC");
    expect(historyCacheKey("b", events, "UTC")).not.toBe(key);
    expect(historyCacheKey("a", events, "America/New_York")).not.toBe(key);
    expect(historyCacheKey("a", events.slice(0, 1), "UTC")).not.toBe(key);
    expect(
      historyCacheKey(
        "a",
        [{ ...events[0], location: "London" }, events[1]],
        "UTC",
      ),
    ).not.toBe(key);
  });
  it.each([
    "",
    '{"clusters":',
    "{}",
    '{"clusters":[{"label":"Invented","eventIds":["wrong","fake"]}]}',
  ])("rejects invalid output and permits a later retry", async (text) => {
    provider.generate.mockResolvedValueOnce({ text });
    await expect(summarizeHistory("a", events, "UTC")).rejects.toMatchObject({
      status: 502,
    });
    expect((await summarizeHistory("a", events, "UTC")).cacheHit).toBe(false);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      "Paris",
    );
  });
  it("deduplicates in-flight work and finishes a stalled provider at the deadline", async () => {
    vi.useFakeTimers();
    provider.generate.mockImplementation(() => new Promise(() => {}));
    const pending = summarizeHistory("a", events, "UTC");
    const failure = expect(pending).rejects.toMatchObject({ status: 502 });
    await expect(summarizeHistory("a", events, "UTC")).rejects.toMatchObject({
      status: 409,
    });
    await vi.advanceTimersByTimeAsync(20001);
    await failure;
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it("does no provider work when the app budget is exhausted", async () => {
    vi.stubEnv("AI_DAILY_BUDGET_USD", "0");
    await expect(summarizeHistory("a", events, "UTC")).rejects.toMatchObject({
      code: "AI_BUDGET_EXHAUSTED",
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
