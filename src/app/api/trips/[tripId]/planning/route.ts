import { NextRequest, NextResponse } from "next/server";
import { readJsonWithLimit } from "@/lib/http";
import { updateTripPlanning } from "@/lib/store";
import { requireAccountActor, tripRouteError } from "@/app/api/trips/_shared";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const actor = await requireAccountActor(req);
    const { tripId } = await params;
    const input = await readJsonWithLimit(req, 32768);
    return NextResponse.json(await updateTripPlanning(tripId, actor, input));
  } catch (error) { return tripRouteError(error, "trips:planning"); }
}
