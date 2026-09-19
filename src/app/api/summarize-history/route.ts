import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/runtime/session";
import { AI_HISTORY_MAX_BODY_BYTES } from "@/lib/ai-inputs";
import { ApiError, jsonError, readJsonWithLimit } from "@/lib/http";
import { parseHistoryEvents, summarizeHistory } from "@/lib/history-summary";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  try {
    const session = await getAppSession(req);
    if (!session?.user)
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    if (!session.user.actorId)
      throw new ApiError(
        process.env.ACTOR_KEY_SECRET ? 401 : 503,
        "AUTH_UNAVAILABLE",
        "Actor identity is unavailable",
      );
    const body = await readJsonWithLimit(req, AI_HISTORY_MAX_BODY_BYTES);
    const events = parseHistoryEvents(body);
    const timeZone = (body as { timeZone?: unknown }).timeZone ?? "UTC";
    if (typeof timeZone !== "string" || timeZone.length > 100)
      throw new ApiError(400, "INVALID_REQUEST", "Invalid timezone");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      throw new ApiError(400, "INVALID_REQUEST", "Invalid timezone");
    }
    return NextResponse.json(
      await summarizeHistory(session.user.actorId, events, timeZone),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
