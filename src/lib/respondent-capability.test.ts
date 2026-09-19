import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureCapabilityFragment,
  getOrCreateRespondentCapability,
  privateReturnUrl,
} from "@/lib/respondent-capability";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function locationWithHash(hash: string): Location {
  return {
    hash,
    pathname: "/join/trip-1",
    search: "?from=share",
  } as Location;
}

function historyMock(): History {
  return {
    state: { navigation: "state" },
    replaceState: vi.fn(),
  } as unknown as History;
}

describe("getOrCreateRespondentCapability", () => {
  it("creates a 32-byte base64url token with WebCrypto", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_value, index) => {
        bytes[index] = index;
      });
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const token = getOrCreateRespondentCapability("trip-1");

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(32);
    expect(token).toBe(
      Buffer.from(Uint8Array.from({ length: 32 }, (_value, index) => index))
        .toString("base64url"),
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("persists one capability per trip and reuses it", () => {
    const first = getOrCreateRespondentCapability("trip-1");
    const repeated = getOrCreateRespondentCapability("trip-1");
    const secondTrip = getOrCreateRespondentCapability("trip-2");

    expect(repeated).toBe(first);
    expect(secondTrip).not.toBe(first);
    expect(storage.length).toBe(2);
  });

  it("replaces malformed persisted capability data", () => {
    storage.setItem("converge:respondent-capability:trip-1", "not-a-capability");

    const token = getOrCreateRespondentCapability("trip-1");

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe("not-a-capability");
    expect(getOrCreateRespondentCapability("trip-1")).toBe(token);
  });
});

describe("captureCapabilityFragment", () => {
  it("persists a valid fragment capability and removes it from the URL", () => {
    const token = "A".repeat(43);
    const location = locationWithHash(`#r=${token}`);
    const history = historyMock();

    const captured = captureCapabilityFragment("trip-1", location, history);

    expect(captured).toBe(token);
    expect(getOrCreateRespondentCapability("trip-1")).toBe(token);
    expect(history.replaceState).toHaveBeenCalledWith(
      history.state,
      "",
      "/join/trip-1?from=share",
    );
  });

  it("ignores invalid or unrelated fragments without changing the URL", () => {
    for (const hash of ["", "#section", "#r=short", `#r=${"A".repeat(44)}`]) {
      const history = historyMock();

      expect(
        captureCapabilityFragment("trip-1", locationWithHash(hash), history),
      ).toBeNull();
      expect(history.replaceState).not.toHaveBeenCalled();
    }
    expect(storage.length).toBe(0);
  });
});

describe("privateReturnUrl", () => {
  it("constructs an encoded join URL with the capability only in the fragment", () => {
    const token = "B".repeat(43);

    const url = privateReturnUrl(
      "trip/with space",
      token,
      "https://converge.example/",
    );

    expect(url).toBe(
      `https://converge.example/join/trip%2Fwith%20space#r=${token}`,
    );
    expect(url.split("#")[0]).not.toContain(token);
  });

  it("rejects malformed capabilities", () => {
    expect(() =>
      privateReturnUrl("trip-1", "not-a-capability", "https://converge.example"),
    ).toThrow("Invalid respondent capability");
  });
});
