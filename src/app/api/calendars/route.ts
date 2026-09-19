import {getAppSession} from "@/lib/runtime/session";
import {ApiError, jsonError} from "@/lib/http";
import { NextRequest, NextResponse } from "next/server";
import { getCalendarAccessToken } from "@/lib/calendar/auth";
import { listAllCalendars } from "@/lib/calendar/google";

export async function GET(req: NextRequest) {
  try {
    const session = await getAppSession(req);
    if (!session?.user?.actorId) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  } catch (error) { return jsonError(error); }
  const accessToken = await getCalendarAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: "No access token" }, { status: 401 });
  }

  try {
    const result = await listAllCalendars(accessToken);
    const calendars = result.items.map((calendar) => ({
      id: calendar.calendarId,
      name: calendar.name,
      color: calendar.color || "#4285F4",
      primary: Boolean(calendar.primary),
    }));

    return NextResponse.json(calendars, {headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch calendars" },
      { status: 500 },
    );
  }
}
