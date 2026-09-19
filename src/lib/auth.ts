import { isDemo } from "./runtime/config";
import { createHash } from "node:crypto";
import type { AuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import { accountActor } from "@/lib/actor";

// Refresh a Google access token using the long-lived refresh token.
// Google access tokens expire after ~1 hour; the NextAuth session cookie
// lives much longer, so without this every calendar call starts failing
// an hour after sign-in.
export async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  if (isDemo()) return {...token, error: "RefreshAccessTokenError"};
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshed = await response.json();
    if (
      !response.ok ||
      typeof refreshed.access_token !== "string" ||
      !refreshed.access_token ||
      !Number.isFinite(refreshed.expires_in) ||
      refreshed.expires_in <= 0
    )
      throw new Error("refresh failed");

    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      // Google only returns a new refresh token sometimes — keep the old one otherwise
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch {
    console.error("[auth] Google token refresh failed");
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        // Initial sign-in
        return {
          ...token,
          providerAccountId: account.providerAccountId,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3600 * 1000,
          error: undefined,
        };
      }

      return ensureGoogleAccessToken(token);
    },
    async session({ session, token }) {
      const actorSecret = process.env.ACTOR_KEY_SECRET;
      if (session.user && token.providerAccountId && actorSecret) {
        session.user.actorId = accountActor(
          token.providerAccountId,
          actorSecret,
        );
      }
      session.error = token.error as string | undefined;
      return session;
    },
  },
};

const refreshes = new Map<string, { promise: Promise<JWT>; until: number }>();
export function resetTokenRefreshCache() {
  refreshes.clear();
}
export async function ensureGoogleAccessToken(token: JWT): Promise<JWT> {
  // Still valid (with a minute of slack)?
  if (token.expiresAt && Date.now() < (token.expiresAt as number) - 60_000) {
    return token;
  }

  if (!token.refreshToken) {
    return { ...token, error: "RefreshAccessTokenError" };
  }
  const key = createHash("sha256")
    .update(String(token.refreshToken))
    .digest("hex");
  const now = Date.now();
  for (const [storedKey, entry] of Array.from(refreshes.entries()))
    if (entry.until <= now) refreshes.delete(storedKey);
  let entry = refreshes.get(key);
  if (!entry) {
    if (refreshes.size >= 500)
      refreshes.delete(Array.from(refreshes.keys())[0]);
    const pending = {
      promise: refreshGoogleAccessToken(token),
      until: now + 11000,
    };
    refreshes.set(key, pending);
    pending.promise.then((result) => {
      if (result.error) refreshes.delete(key);
      else pending.until = Number(result.expiresAt) - 60000;
    });
    entry = pending;
  }
  const refreshed = await entry.promise;
  return {
    ...token,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshed.refreshToken,
    error: refreshed.error,
  };
}
