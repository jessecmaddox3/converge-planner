const STORAGE_PREFIX = "converge:respondent-capability:";
const CAPABILITY_RE = /^[A-Za-z0-9_-]{43}$/;

function assertTripId(tripId: string): void {
  if (!tripId) throw new Error("Trip ID is required");
}

function storageKey(tripId: string): string {
  assertTripId(tripId);
  return `${STORAGE_PREFIX}${encodeURIComponent(tripId)}`;
}

function browserStorage(): Storage {
  try {
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    // Access can throw when browser storage is disabled.
  }
  throw new Error("Browser storage is unavailable");
}

function validCapability(value: unknown): value is string {
  return typeof value === "string" && CAPABILITY_RE.test(value);
}

function base64Url(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== "function") {
    throw new Error("Base64 encoding is unavailable");
  }
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }
  return globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCapability(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("WebCrypto is unavailable");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function getStoredRespondentCapability(tripId: string): string | null {
  const existing = browserStorage().getItem(storageKey(tripId));
  return validCapability(existing) ? existing : null;
}

export function getOrCreateRespondentCapability(tripId: string): string {
  const storage = browserStorage();
  const key = storageKey(tripId);
  const existing = storage.getItem(key);
  if (validCapability(existing)) return existing;

  const created = createCapability();
  storage.setItem(key, created);
  return created;
}

export function captureCapabilityFragment(
  tripId: string,
  location: Location,
  history: History,
): string | null {
  const fragment = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;
  if (!fragment) return null;

  const token = new URLSearchParams(fragment).get("r");
  if (!validCapability(token)) return null;

  browserStorage().setItem(storageKey(tripId), token);
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`,
  );
  return token;
}

export function privateReturnUrl(
  tripId: string,
  token: string,
  origin: string,
): string {
  assertTripId(tripId);
  if (!validCapability(token)) {
    throw new Error("Invalid respondent capability");
  }
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/join/${encodeURIComponent(tripId)}#r=${token}`;
}
