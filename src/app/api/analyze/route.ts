import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/runtime/session";
import { ApiError, jsonError } from "@/lib/http";

// Date assessment is now deterministic and runs locally in the planner. Keep a
// clear response for old tabs without issuing a paid, decorative model request.
export async function POST() {
  try {
    if (!(await getAppSession())?.user)
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    return NextResponse.json(
      {
        error: {
          code: "RETIRED",
          message: "Refresh Converge to use the new date planner.",
        },
      },
      { status: 410 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
