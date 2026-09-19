import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runNotificationWorker } from "@/lib/notification-worker";
import { getStorage } from "@/lib/storage";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Maintenance unavailable" },
      { status: 503 },
    );
  const actual = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  let maintenanceCompleted = false;
  try {
    const client = getStorage();
    if (client) {
      const { error } = await client.rpc("cleanup_converge_storage");
      if (error) throw new Error("Maintenance unavailable");
    }
    maintenanceCompleted = true;
  } catch {
    console.error(
      "[maintenance] Cleanup failed; delivery recovery will still run",
    );
  }
  try {
    const result = await runNotificationWorker({
      maxDurationMs: Math.max(0, 50000 - (Date.now() - startedAt)),
    });
    return NextResponse.json(
      { ...result, maintenanceCompleted },
      { status: maintenanceCompleted ? 200 : 503 },
    );
  } catch {
    console.error(
      "[maintenance] Delivery sweep failed; private details omitted",
    );
    return NextResponse.json(
      { error: "Maintenance unavailable", maintenanceCompleted },
      { status: 503 },
    );
  }
}
