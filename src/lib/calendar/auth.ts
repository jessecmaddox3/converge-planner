import { isDemo } from "@/lib/runtime/config";
import { demoSession } from "@/lib/demo/session";
import { demoPeople } from "@/lib/demo/people";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { ensureGoogleAccessToken } from "@/lib/auth";

// Read and refresh exclusively on the server. Never put a provider token into
// NextAuth's public session object or require a browser Authorization header.
export async function getCalendarAccessToken(
  req: NextRequest,
): Promise<string | null> {
  if (isDemo()) {
    const session = await demoSession(req);
    const person = demoPeople.find(p => p.email === session?.user?.email);
    return person ? "local-fixture:" + person.id : null;
  }
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return null;
    const fresh = await ensureGoogleAccessToken(token);
    return !fresh.error &&
      typeof fresh.accessToken === "string" &&
      fresh.accessToken
      ? fresh.accessToken
      : null;
  } catch {
    return null;
  }
}
