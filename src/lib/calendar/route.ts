import { getAppSession } from "@/lib/runtime/session";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, jsonError, readJsonWithLimit } from "@/lib/http";
import { CalendarRangeError } from "./range";
import { getCalendarAccessToken } from "./auth";
import { cachedCalendarScan, parseScanRequest } from "./cache";

export async function handleCalendarScan(
  request: NextRequest,
  historyOnly = false,
) {
  try {
    const session = await getAppSession(request);
    if (!session?.user)
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    if (!session.user.actorId)
      throw new ApiError(
        process.env.ACTOR_KEY_SECRET ? 401 : 503,
        "AUTH_UNAVAILABLE",
        "Please sign in again to check your calendar.",
      );
    const input = parseScanRequest(await readJsonWithLimit(request, 32768));
    const result = await cachedCalendarScan(
      session.user.actorId,
      input,
      () => getCalendarAccessToken(request),
      historyOnly,
    );
    const periods =
      "current" in result.value ? [result.value.current] : result.value.history;
    return NextResponse.json(result.value, {
      status:
        periods.length &&
        periods.every((period) => period.coverage.status === "failed")
          ? 502
          : 200,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Converge-Cache": result.cacheHit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof CalendarRangeError
        ? new ApiError(400, error.code, "Invalid calendar scan range")
        : error,
    );
  }
}
