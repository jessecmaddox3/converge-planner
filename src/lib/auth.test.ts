import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { accountActor } from "@/lib/actor";
import {
  authOptions,
  ensureGoogleAccessToken,
  resetTokenRefreshCache,
} from "@/lib/auth";

type JwtCallback = (args: {
  token: JWT;
  account: Account | null;
}) => Promise<JWT>;
type SessionCallback = (args: {
  session: Session;
  token: JWT;
}) => Promise<Session>;

const jwtCallback = authOptions.callbacks!.jwt as JwtCallback;
const sessionCallback = authOptions.callbacks!.session as SessionCallback;

function googleAccount(): Account {
  return {
    provider: "google",
    type: "oauth",
    providerAccountId: "google-account-123",
    access_token: "access-initial",
    refresh_token: "refresh-initial",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "Bearer",
    scope: "openid email profile",
    id_token: "google-id-token",
  };
}

function browserSession(): Session {
  return {
    user: {
      name: "Quinn",
      email: "quinn@example.com",
      image: null,
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

beforeEach(resetTokenRefreshCache);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authOptions jwt callback", () => {
  it("stores providerAccountId and existing Google tokens on initial sign-in", async () => {
    const result = await jwtCallback({ token: {}, account: googleAccount() });

    expect(result).toMatchObject({
      providerAccountId: "google-account-123",
      accessToken: "access-initial",
      refreshToken: "refresh-initial",
      error: undefined,
    });
  });

  it("preserves providerAccountId and accessToken while the token is valid", async () => {
    const token: JWT = {
      providerAccountId: "google-account-123",
      accessToken: "access-valid",
      refreshToken: "refresh-valid",
      expiresAt: Date.now() + 120_000,
    };

    const result = await jwtCallback({ token, account: null });

    expect(result).toBe(token);
    expect(result.providerAccountId).toBe("google-account-123");
    expect(result.accessToken).toBe("access-valid");
  });

  it("preserves providerAccountId when Google refreshes the access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "access-refreshed",
              expires_in: 3600,
              refresh_token: "refresh-rotated",
              scope: "openid email profile",
              token_type: "Bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const token: JWT = {
      providerAccountId: "google-account-123",
      accessToken: "access-expired",
      refreshToken: "refresh-initial",
      expiresAt: Date.now() - 1,
    };

    const result = await jwtCallback({ token, account: null });

    expect(result).toMatchObject({
      providerAccountId: "google-account-123",
      accessToken: "access-refreshed",
      refreshToken: "refresh-rotated",
      error: undefined,
    });
  });

  it("preserves providerAccountId and existing accessToken when refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "Refresh token expired",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const token: JWT = {
      providerAccountId: "google-account-123",
      accessToken: "access-expired",
      refreshToken: "refresh-invalid",
      expiresAt: Date.now() - 1,
    };

    const result = await jwtCallback({ token, account: null });

    expect(result).toMatchObject({
      providerAccountId: "google-account-123",
      accessToken: "access-expired",
      error: "RefreshAccessTokenError",
    });
  });
});

describe("authOptions session callback", () => {
  it("derives actorId with ACTOR_KEY_SECRET without exposing the Google token", async () => {
    vi.stubEnv("ACTOR_KEY_SECRET", "server-pepper");
    const result = await sessionCallback({
      session: browserSession(),
      token: {
        providerAccountId: "google-account-123",
        accessToken: "access-valid",
        error: "RefreshAccessTokenError",
      },
    });

    expect(result.user?.actorId).toBe(
      accountActor("google-account-123", "server-pepper"),
    );
    expect(result).not.toHaveProperty("accessToken");
    expect(result.error).toBe("RefreshAccessTokenError");
    expect(result).not.toHaveProperty("providerAccountId");
    expect(result.user).not.toHaveProperty("providerAccountId");
  });

  it("omits actorId and providerAccountId when ACTOR_KEY_SECRET is absent", async () => {
    vi.stubEnv("ACTOR_KEY_SECRET", "");
    const result = await sessionCallback({
      session: browserSession(),
      token: {
        providerAccountId: "google-account-123",
        accessToken: "access-valid",
      },
    });

    expect(result.user?.actorId).toBeUndefined();
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("providerAccountId");
    expect(result.user).not.toHaveProperty("providerAccountId");
  });
});

it("coalesces concurrent server refreshes while preserving each JWT's claims", async () => {
  const refresh = vi.fn(
    async () =>
      new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 })),
  );
  vi.stubGlobal("fetch", refresh);
  const [first, second] = await Promise.all([
    ensureGoogleAccessToken({
      refreshToken: "same-refresh",
      expiresAt: 1,
      sub: "first",
    }),
    ensureGoogleAccessToken({
      refreshToken: "same-refresh",
      expiresAt: 1,
      sub: "second",
    }),
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(first).toMatchObject({ sub: "first", accessToken: "fresh" });
  expect(second).toMatchObject({ sub: "second", accessToken: "fresh" });
});
