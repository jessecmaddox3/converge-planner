import { describe, expect, it } from "vitest";
import {
  accountActor,
  capabilityActor,
  newCapability,
} from "@/lib/actor";

describe("accountActor", () => {
  it("rejects an empty provider account ID", () => {
    expect(() => accountActor("", "pepper")).toThrow("providerAccountId is required");
  });

  it("rejects an empty pepper", () => {
    expect(() => accountActor("123", "")).toThrow("pepper is required");
  });

  it("is deterministic for the same provider account and pepper", () => {
    expect(accountActor("123", "pepper")).toBe(accountActor("123", "pepper"));
  });

  it("separates provider accounts and peppers without exposing the provider ID", () => {
    const actor = accountActor("123", "pepper");

    expect(actor).toMatch(/^account:[a-f0-9]{64}$/);
    expect(actor).not.toContain("123");
    expect(actor).not.toBe(accountActor("124", "pepper"));
    expect(actor).not.toBe(accountActor("123", "other-pepper"));
  });
});

describe("capabilityActor", () => {
  it("is deterministic, namespaced, and does not expose the raw capability", () => {
    const token = "private-return-capability";
    const actor = capabilityActor(token);

    expect(actor).toMatch(/^capability:[a-f0-9]{64}$/);
    expect(actor).toBe(capabilityActor(token));
    expect(actor).not.toContain(token);
    expect(actor).not.toBe(capabilityActor(token + "-other"));
  });
});

describe("newCapability", () => {
  it("creates a 32-byte base64url token and its hash-derived actor key", () => {
    const capability = newCapability();

    expect(capability.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(capability.actorKey).toBe(capabilityActor(capability.token));
    expect(capability.actorKey).not.toContain(capability.token);
  });

  it("creates a fresh capability on each call", () => {
    const first = newCapability();
    const second = newCapability();

    expect(second.token).not.toBe(first.token);
    expect(second.actorKey).not.toBe(first.actorKey);
  });
});
