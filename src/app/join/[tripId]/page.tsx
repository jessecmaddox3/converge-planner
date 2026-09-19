import { getTrip, toPublicTrip } from "@/lib/store";

// Trip data must never be served from the static/route cache.
export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import JoinClient from "./JoinClient";

export default async function JoinPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  let trip;
  try {
    trip = await getTrip(tripId);
  } catch (err) {
    console.error("[join] Storage error loading trip", tripId, ":", String(err));
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px", textAlign: "center", fontFamily: "-apple-system, sans-serif" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <h1 style={{ fontSize: 20, color: "#1B4332", marginBottom: 8 }}>Temporarily unavailable</h1>
        <p style={{ color: "#6B7280", fontSize: 14 }}>
          We couldn&apos;t load this trip right now. Please try again in a minute.
        </p>
      </div>
    );
  }

  if (!trip) {
    notFound();
  }

  // Only the sanitized view crosses to the client — no email addresses.
  return <JoinClient tripId={tripId} tripData={toPublicTrip(trip)} />;
}
