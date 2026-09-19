import { createHash } from "node:crypto";
import { notificationTransport } from "./notifications";
import { confirmationEmail } from "./confirmation-email";
import {
  claimNotificationBatch,
  finishNotification,
  getTrip,
  notificationClaimIsCurrent,
  releaseNotificationClaim,
} from "./store";

export async function runNotificationWorker({
  tripId,
  maxDurationMs = 45000,
  maxDeliveries = 30,
}: { tripId?: string; maxDurationMs?: number; maxDeliveries?: number } = {}) {
  const counts = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  // A disabled transport leaves durable jobs pending without spending attempts.
  const transporter = notificationTransport();
  if (!transporter) return counts;
  const deadline = Date.now() + Math.min(maxDurationMs, 45000);
  try {
    while (
      counts.attempted < Math.min(maxDeliveries, 30) &&
      deadline - Date.now() >= 22000
    ) {
      const claims = await claimNotificationBatch(
        tripId,
        Math.min(3, maxDeliveries - counts.attempted),
      );
      if (!claims.length) break;
      counts.attempted += claims.length;
      await Promise.all(
        claims.map(async (claim) => {
          let succeeded = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const trip = await getTrip(claim.tripId);
            if (
              !trip ||
              trip.status !== "confirmed" ||
              trip.confirmationVersion !== claim.confirmationVersion
            ) {
              counts.skipped++;
              return;
            }
            const email = confirmationEmail(trip);
            if (deadline - Date.now() < 20000) {
              await releaseNotificationClaim(claim);
              counts.skipped++;
              return;
            }
            if (!(await notificationClaimIsCurrent(claim))) {
              counts.skipped++;
              return;
            }
            const messageId = createHash("sha256")
              .update(
                JSON.stringify([
                  claim.tripId,
                  claim.confirmationVersion,
                  claim.responsePublicId,
                ]),
              )
              .digest("hex");
            await Promise.race([
              transporter.sendMail({
                ...email,
                from: transporter.from,
                to: claim.toEmail,
                messageId: `<${messageId}@${trip.calendarNamespace || "converge-planner.invalid"}>`,
              }, claim),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("SMTP deadline")),
                  20000,
                );
              }),
            ]);
            succeeded = true;
            counts.sent++;
          } catch {
            counts.failed++;
            console.error(
              "[notifications] Delivery failed; recipient details omitted",
            );
          } finally {
            if (timer) clearTimeout(timer);
          }
          try {
            await finishNotification(claim, succeeded);
          } catch {
            console.error(
              "[notifications] Delivery bookkeeping failed; lease recovery will retry",
            );
          }
        }),
      );
    }
  } finally {
    transporter.close();
  }
  return counts;
}
