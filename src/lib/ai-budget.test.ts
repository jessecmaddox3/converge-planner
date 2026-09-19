import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./supabase-server", () => ({ getSupabaseServiceClient: () => null }));
import {
  reserveGeneration,
  recordGeneration,
  resetAIBudget,
  reservedCostMicros,
  actualCostMicros,
} from "./ai-budget";
beforeEach(resetAIBudget);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("reserves a conservative amount before work and rejects a request beyond the daily budget", async () => {
  vi.stubEnv("AI_DAILY_BUDGET_USD", "0.01");
  const reservation = await reserveGeneration("short prompt");
  expect(reservation).toBeTruthy();
  await expect(reserveGeneration("short prompt")).rejects.toMatchObject({
    status: 429,
    code: "AI_BUDGET_EXHAUSTED",
  });
  await recordGeneration(reservation, {
    inputTokens: 100,
    outputTokens: 10,
    thinkingTokens: 0,
    model: "gemini-3.5-flash-lite",
    promptVersion: "v1",
    cacheHit: false,
    latencyMs: 400,
    finishReason: "STOP",
    validated: true,
  });
  expect(await reserveGeneration("short prompt")).toBeTruthy();
});
it("keeps the reservation for unknown provider usage and counts thinking as billable output", async () => {
  vi.stubEnv("AI_DAILY_BUDGET_USD", "0.01");
  const reservation = await reserveGeneration("prompt");
  await recordGeneration(reservation, {
    inputTokens: null,
    outputTokens: null,
    thinkingTokens: null,
    model: "gemini-3.5-flash-lite",
    promptVersion: "v1",
    cacheHit: false,
    latencyMs: 20000,
    finishReason: "timeout",
    validated: false,
  });
  await expect(reserveGeneration("prompt")).rejects.toMatchObject({
    code: "AI_BUDGET_EXHAUSTED",
  });
  expect(actualCostMicros(1000, 100, 20)).toBe(600);
  expect(reservedCostMicros("😀".repeat(100))).toBeGreaterThan(
    reservedCostMicros("a".repeat(100)),
  );
});
