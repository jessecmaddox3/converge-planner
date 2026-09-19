import { NextRequest, NextResponse } from "next/server";
import { getManagedTrip, getNotificationSummary } from "@/lib/store";
import { requireAccountActor, tripRouteError } from "@/app/api/trips/_shared";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const { tripId } = await params;
    const actor = await requireAccountActor(req);
    const trip = await getManagedTrip(tripId, actor, { claimLegacy: true });
    const notifications =
      trip.status === "confirmed"
        ? await getNotificationSummary(tripId, trip.confirmationVersion)
        : undefined;
    return NextResponse.json({ ...trip, notifications });
  } catch (error) {
    return tripRouteError(error, "trips:manage");
  }
}
