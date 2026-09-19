import { NextRequest, NextResponse } from "next/server";
import { readJsonWithLimit } from "@/lib/http";
import {
  getTrip,
  NotFoundError,
  submitAvailability,
} from "@/lib/store";
import { parseAvailability } from "@/lib/trip-validation";
import { enforceAvailabilityQuota } from "@/lib/availability-quota";
import {
  requireViewerActor,
  TRIP_AVAILABILITY_MAX_BODY_BYTES,
  tripRouteError,
} from "@/app/api/trips/_shared";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const { tripId } = await params;
    const actor = await requireViewerActor(req);
    const trip = await getTrip(tripId);
    if (!trip) throw new NotFoundError();
    const input = parseAvailability(
      await readJsonWithLimit(req, TRIP_AVAILABILITY_MAX_BODY_BYTES),
      trip,
    );
    await enforceAvailabilityQuota(req, tripId, actor.actorKey);
    const response = await submitAvailability(tripId, actor, input);
    return NextResponse.json({ success: true, response });
  } catch (error) {
    return tripRouteError(error, "trips:availability");
  }
}
