import { NextRequest, NextResponse } from "next/server";
import { getViewerState } from "@/lib/store";
import {
  optionalViewerActor,
  tripRouteError,
} from "@/app/api/trips/_shared";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const { tripId } = await params;
    const actor = await optionalViewerActor(req);
    return NextResponse.json(await getViewerState(tripId, actor));
  } catch (error) {
    return tripRouteError(error, "trips:viewer");
  }
}
