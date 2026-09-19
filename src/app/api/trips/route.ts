import { NextRequest, NextResponse } from "next/server";
import { readJsonWithLimit } from "@/lib/http";
import { createTrip, listTripsForActor } from "@/lib/store";
import { parseCreateTrip } from "@/lib/trip-validation";
import {
  requireAccountActor,
  TRIP_CREATE_MAX_BODY_BYTES,
  tripRouteError,
} from "@/app/api/trips/_shared";

export async function POST(req: NextRequest) {
  try {
    const organizer = await requireAccountActor(req);
    const input = parseCreateTrip(
      await readJsonWithLimit(req, TRIP_CREATE_MAX_BODY_BYTES),
    );
    const id = await createTrip(input, organizer);
    return NextResponse.json({ id });
  } catch (error) {
    return tripRouteError(error, "trips:create");
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccountActor(req);
    if (req.nextUrl.searchParams.get("mine") !== "1") {
      throw new Error("INVALID_INPUT");
    }
    const trips = await listTripsForActor(actor);
    return NextResponse.json({ trips });
  } catch (error) {
    return tripRouteError(error, "trips:list");
  }
}
