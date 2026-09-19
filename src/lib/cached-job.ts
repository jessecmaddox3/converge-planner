import { randomUUID } from "node:crypto";
import { getStorage } from "./storage";
import { ApiError } from "./http";

type Entry = {
  lease: string | null;
  leaseUntil: number;
  expires: number;
  value?: unknown;
};
const memory = new Map<string, Entry>();
export function resetJobCache() {
  memory.clear();
}
const unavailable = () =>
  new ApiError(
    503,
    "CACHE_UNAVAILABLE",
    "Saved results are temporarily unavailable. Please retry.",
  );

export async function cachedJob<T>(
  key: string,
  options: {
    ttlSeconds: number;
    leaseSeconds: number;
    refresh?: boolean;
    generate: () => Promise<T>;
    cacheable?: (value: T) => boolean;
  },
): Promise<{ value: T; cacheHit: boolean }> {
  if (
    !key ||
    key.length > 256 ||
    options.ttlSeconds < 1 ||
    options.ttlSeconds > 604800 ||
    options.leaseSeconds < 1 ||
    options.leaseSeconds > 120
  )
    throw new Error("Invalid cache configuration");
  let client: ReturnType<typeof getStorage>;
  try {
    client = getStorage();
  } catch {
    throw unavailable();
  }
  let lease = "";
  if (client) {
    const { data, error } = await client.rpc("claim_cached_job", {
      p_key: key,
      p_lease_seconds: options.leaseSeconds,
      p_force: Boolean(options.refresh),
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !row || !["hit", "pending", "claimed"].includes(row.state))
      throw unavailable();
    if (row.state === "hit") return { value: row.value as T, cacheHit: true };
    if (row.state === "pending")
      throw new ApiError(
        409,
        "CACHE_PENDING",
        "This check is already running. Try again in a few seconds.",
        3,
      );
    if (typeof row.lease_token !== "string") throw unavailable();
    lease = row.lease_token;
  } else {
    const now = Date.now();
    for (const [entryKey, entry] of Array.from(memory.entries()))
      if (entry.expires <= now && entry.leaseUntil <= now)
        memory.delete(entryKey);
    const current = memory.get(key);
    if (current && current.leaseUntil > now)
      throw new ApiError(
        409,
        "CACHE_PENDING",
        "This check is already running. Try again in a few seconds.",
        3,
      );
    if (current && current.expires > now && !options.refresh)
      return { value: current.value as T, cacheHit: true };
    lease = randomUUID();
    memory.set(key, {
      lease,
      leaseUntil: now + options.leaseSeconds * 1000,
      expires: 0,
    });
  }
  async function release() {
    if (client) {
      const { error } = await client.rpc("release_cached_job", {
        p_key: key,
        p_lease: lease,
      });
      if (error) throw unavailable();
    } else if (memory.get(key)?.lease === lease) memory.delete(key);
  }
  try {
    const value = await options.generate();
    if (options.cacheable && !options.cacheable(value)) {
      await release();
      return { value, cacheHit: false };
    }
    let completed = false;
    if (client) {
      const { data, error } = await client.rpc("complete_cached_job", {
        p_key: key,
        p_lease: lease,
        p_value: value,
        p_ttl_seconds: options.ttlSeconds,
      });
      if (error) throw unavailable();
      completed = data === true;
    } else {
      const entry = memory.get(key);
      if (entry?.lease === lease && entry.leaseUntil > Date.now()) {
        memory.set(key, {
          lease: null,
          leaseUntil: 0,
          expires: Date.now() + options.ttlSeconds * 1000,
          value,
        });
        completed = true;
      }
    }
    // The result belongs to this caller's exact input. If its lease expired,
    // return the validated work without overwriting a newer cached result.
    if (!completed) await release();
    return { value, cacheHit: false };
  } catch (error) {
    try {
      await release();
    } catch {
      /* The bounded lease also recovers after storage outages. */
    }
    throw error;
  }
}
