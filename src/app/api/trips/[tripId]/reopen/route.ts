import { NextRequest, NextResponse } from "next/server";
import { reopenTrip } from "@/lib/store";
import {
  requireAccountActor,
  tripRouteError,
} from "@/app/api/trips/_shared";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const { tripId } = await params;
    const actor = await requireAccountActor(req);
    return NextResponse.json(await reopenTrip(tripId, actor));
  } catch (error) {
    return tripRouteError(error, "trips:reopen");
  }
}
