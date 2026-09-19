import { getStorage } from "@/lib/storage";

export interface QuotaInput {
  actorKey: string;
  action: string;
  windowSeconds: number;
  limit: number;
}

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

const MAX_WINDOW_SECONDS = 86_400;
const MAX_QUOTA_LIMIT = 10_000;

type RateLimitGlobals = typeof globalThis & {
  __convergeRateLimits?: Map<string, number>;
};

const globals = globalThis as RateLimitGlobals;
const memoryCounters = globals.__convergeRateLimits ??
  (globals.__convergeRateLimits = new Map<string, number>());

export function __resetMemoryRateLimits(): void {
  memoryCounters.clear();
}

function quotaKey(input: QuotaInput): string {
  return `${input.actorKey.length}:${input.actorKey}:${input.action}:${input.windowSeconds}`;
}

function assertQuotaInput(input: QuotaInput): void {
  if (
    !input.actorKey ||
    !input.action ||
    !Number.isInteger(input.windowSeconds) ||
    input.windowSeconds < 1 ||
    input.windowSeconds > MAX_WINDOW_SECONDS ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_QUOTA_LIMIT
  ) {
    throw new Error("Invalid quota configuration");
  }
}

function consumeMemory(input: QuotaInput): QuotaResult {
  const now = Math.floor(Date.now() / 1000);
  const bucketStart = Math.floor(now / input.windowSeconds) * input.windowSeconds;
  const counterKey = `${quotaKey(input)}:${bucketStart}`;
  const count = Math.min((memoryCounters.get(counterKey) ?? 0) + 1, input.limit + 1);
  memoryCounters.set(counterKey, count);

  const allowed = count <= input.limit;
  return {
    allowed,
    remaining: Math.max(input.limit - count, 0),
    retryAfter: allowed ? 0 : bucketStart + input.windowSeconds - now,
  };
}

function isValidRpcResult(
  row: unknown,
  input: QuotaInput,
): row is { allowed: boolean; remaining: number; retry_after: number } {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  if (
    typeof value.allowed !== "boolean" ||
    typeof value.remaining !== "number" ||
    !Number.isFinite(value.remaining) ||
    !Number.isInteger(value.remaining) ||
    value.remaining < 0 ||
    value.remaining > input.limit ||
    typeof value.retry_after !== "number" ||
    !Number.isFinite(value.retry_after) ||
    !Number.isInteger(value.retry_after)
  ) {
    return false;
  }
  if (value.allowed) return value.remaining <= input.limit - 1 && value.retry_after === 0;
  return value.remaining === 0 && value.retry_after > 0 && value.retry_after <= input.windowSeconds;
}

export async function consumeQuota(input: QuotaInput): Promise<QuotaResult> {
  assertQuotaInput(input);

  let client;
  try {
    client = getStorage();
  } catch {
    throw new Error("Quota storage unavailable");
  }

  if (!client) {
    if (process.env.VERCEL) throw new Error("Quota storage unavailable");
    return consumeMemory(input);
  }

  try {
    const { data, error } = await client.rpc("consume_rate_limit", {
      p_key: quotaKey(input),
      p_window_seconds: input.windowSeconds,
      p_limit: input.limit,
    });
    if (error || !Array.isArray(data) || data.length !== 1) {
      throw new Error("RPC failed");
    }
    const row = data[0];
    if (!isValidRpcResult(row, input)) throw new Error("Invalid RPC result");
    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfter: row.retry_after,
    };
  } catch {
    throw new Error("Quota storage unavailable");
  }
}
