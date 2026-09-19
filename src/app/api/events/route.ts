import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/runtime/session";
import { ApiError, jsonError } from "@/lib/http";

// Replaced by bounded, server-authenticated /api/calendar-scan. Browser-provided
// Google bearer tokens are no longer accepted by any calendar route.
export async function GET() {
  try {
    if (!(await getAppSession())?.user)
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    return NextResponse.json(
      {
        error: {
          code: "RETIRED",
          message: "Refresh Converge to use the new calendar check.",
        },
      },
      { status: 410 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
