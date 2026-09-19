import { randomUUID } from "node:crypto";
import { AI_HISTORY_MAX_OUTPUT_TOKENS } from "./ai-inputs";
import { getStorage } from "./storage";
import { ApiError } from "./http";

// Standard gemini-3.5-flash-lite rates verified September 19, 2026.
// https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite
const INPUT_MICROS_PER_TOKEN = 0.3;
const OUTPUT_MICROS_PER_TOKEN = 2.5;
export interface GenerationUsage {
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  finishReason: string;
  validated: boolean;
  eventCount?: number;
}
const spent = new Map<string, number>();
const reservations = new Map<
  string,
  { day: string; reserved: number; finished: boolean }
>();
export function resetAIBudget() {
  spent.clear();
  reservations.clear();
}
export function actualCostMicros(
  input: number,
  output: number,
  thinking: number,
): number {
  return Math.ceil(
    input * INPUT_MICROS_PER_TOKEN +
      (output + thinking) * OUTPUT_MICROS_PER_TOKEN,
  );
}
export function reservedCostMicros(prompt: string): number {
  // A byte upper bound avoids an extra countTokens request. Include headroom for
  // the schema/protocol; reserve the full possible output, including reasoning.
  return actualCostMicros(
    Buffer.byteLength(prompt, "utf8") + 4096,
    AI_HISTORY_MAX_OUTPUT_TOKENS,
    0,
  );
}
function budgetLimit(): number {
  const dollars = Number(process.env.AI_DAILY_BUDGET_USD ?? "1");
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100)
    throw new ApiError(
      503,
      "AI_BUDGET_UNAVAILABLE",
      "History analysis is temporarily unavailable.",
    );
  return Math.floor(dollars * 1_000_000);
}
export async function reserveGeneration(prompt: string): Promise<string> {
  const reserved = reservedCostMicros(prompt);
  const limit = budgetLimit();
  const client = getStorage();
  if (client) {
    const { data, error } = await client.rpc("reserve_ai_generation", {
      p_reserved_micros: reserved,
      p_daily_limit_micros: limit,
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !row || typeof row.allowed !== "boolean")
      throw new ApiError(
        503,
        "AI_BUDGET_UNAVAILABLE",
        "History analysis is temporarily unavailable.",
      );
    if (!row.allowed)
      throw new ApiError(
        429,
        "AI_BUDGET_EXHAUSTED",
        "The daily history-analysis budget has been reached. Date planning still works.",
        Number(row.retry_after) || 3600,
      );
    if (typeof row.reservation_id !== "string")
      throw new ApiError(
        503,
        "AI_BUDGET_UNAVAILABLE",
        "History analysis is temporarily unavailable.",
      );
    return row.reservation_id;
  }
  const day = new Date().toISOString().slice(0, 10);
  if ((spent.get(day) || 0) + reserved > limit)
    throw new ApiError(
      429,
      "AI_BUDGET_EXHAUSTED",
      "The daily history-analysis budget has been reached. Date planning still works.",
      Math.ceil((Date.parse(day) + 86400000 - Date.now()) / 1000),
    );
  spent.set(day, (spent.get(day) || 0) + reserved);
  const id = randomUUID();
  reservations.set(id, { day, reserved, finished: false });
  return id;
}
export async function recordGeneration(
  id: string,
  usage: GenerationUsage,
): Promise<void> {
  const actual =
    usage.inputTokens !== null &&
    usage.outputTokens !== null &&
    usage.thinkingTokens !== null
      ? actualCostMicros(
          usage.inputTokens,
          usage.outputTokens,
          usage.thinkingTokens,
        )
      : null;
  const client = getStorage();
  if (client) {
    const { error } = await client.rpc("record_ai_generation", {
      p_reservation_id: id,
      p_actual_micros: actual,
      p_metadata: usage,
    });
    if (error) throw new Error("AI usage recording unavailable");
  } else {
    const entry = reservations.get(id);
    if (!entry || entry.finished) return;
    if (actual !== null)
      spent.set(
        entry.day,
        (spent.get(entry.day) || 0) + actual - entry.reserved,
      );
    entry.finished = true;
  }
}
