import { NextRequest, NextResponse } from "next/server";
import { getTrip, NotFoundError, toPublicTrip } from "@/lib/store";
import { tripRouteError } from "@/app/api/trips/_shared";

// Trip data must never be served from the static/route cache.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const { tripId } = await params;
    const trip = await getTrip(tripId);

    if (!trip) {
      throw new NotFoundError();
    }

    return NextResponse.json(toPublicTrip(trip));
  } catch (error) {
    return tripRouteError(error, "trips:public");
  }
}
