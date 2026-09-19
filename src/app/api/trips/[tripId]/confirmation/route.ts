import { after, NextRequest, NextResponse } from "next/server";
import { runNotificationWorker } from "@/lib/notification-worker";
import { readJsonWithLimit } from "@/lib/http";
import { confirmTripOnce, getNotificationSummary } from "@/lib/store";
import { isLocalDate } from "@/lib/trip-validation";
import {
  requireAccountActor,
  TRIP_CONFIRMATION_MAX_BODY_BYTES,
  tripRouteError,
} from "@/app/api/trips/_shared";

export const maxDuration = 60;

function parseConfirmedDate(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    !isLocalDate((value as { confirmedDate?: unknown }).confirmedDate)
  ) {
    throw new Error("INVALID_DATE");
  }
  return (value as { confirmedDate: string }).confirmedDate;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const { tripId } = await params;
    const actor = await requireAccountActor(req);
    const confirmedDate = parseConfirmedDate(
      await readJsonWithLimit(req, TRIP_CONFIRMATION_MAX_BODY_BYTES),
    );
    const result = await confirmTripOnce(tripId, actor, confirmedDate);
    const notifications = await getNotificationSummary(
      tripId,
      result.confirmationVersion,
    );
    after(async () => {
      try {
        await runNotificationWorker({ tripId });
      } catch {
        console.error(
          "[notifications] Background worker failed; scheduled recovery will retry",
        );
      }
    });
    return NextResponse.json({ success: true, ...result, notifications });
  } catch (error) {
    return tripRouteError(error, "trips:confirmation");
  }
}
