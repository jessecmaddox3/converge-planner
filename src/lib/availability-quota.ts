import { createHmac } from "node:crypto";
import { consumeQuota } from "./rate-limit";
import { ApiError } from "./http";

export async function enforceAvailabilityQuota(req: Request, tripId: string, actorKey: string): Promise<void> {
  const limits = [
    { actorKey, action: "availability-edit", windowSeconds: 60, limit: 10 },
    { actorKey: `trip:${tripId}`, action: "availability-write", windowSeconds: 60, limit: 60 },
  ];
  // Only trust the deployment edge's header. Never store an address in quota rows.
  // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
  if (process.env.VERCEL) {
    const source = req.headers.get("x-vercel-forwarded-for") || "unknown-edge-source";
    const secret = process.env.ACTOR_KEY_SECRET;
    if (!secret) throw new ApiError(503, "AUTH_UNAVAILABLE", "Response protection is temporarily unavailable");
    const key = createHmac("sha256", secret).update(source).digest("base64url");
    limits.push({ actorKey: `source:${key}`, action: "availability-write", windowSeconds: 600, limit: 60 });
  }
  for (const limit of limits) {
    const result = await consumeQuota(limit);
    if (!result.allowed) throw new ApiError(429, "RATE_LIMITED", "Too many edits. Wait a moment and save again.", result.retryAfter);
  }
}
