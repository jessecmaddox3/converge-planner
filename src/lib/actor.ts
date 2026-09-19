import { createHash, createHmac, randomBytes } from "node:crypto";

export interface CapabilityActor {
  token: string;
  actorKey: string;
}

export function accountActor(providerAccountId: string, pepper: string): string {
  if (!providerAccountId) {
    throw new Error("providerAccountId is required");
  }
  if (!pepper) {
    throw new Error("pepper is required");
  }

  const digest = createHmac("sha256", pepper)
    .update("account:")
    .update(providerAccountId)
    .digest("hex");
  return "account:" + digest;
}

export function capabilityActor(token: string): string {
  const digest = createHash("sha256").update(token).digest("hex");
  return "capability:" + digest;
}

export function newCapability(): CapabilityActor {
  const token = randomBytes(32).toString("base64url");
  return { token, actorKey: capabilityActor(token) };
}
