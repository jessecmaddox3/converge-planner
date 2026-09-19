import type { NextRequest } from "next/server";
import { handleCalendarScan } from "@/lib/calendar/route";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  return handleCalendarScan(request);
}
