"use client";

import JoinFlow from "@/components/converge/JoinFlow";
import type { PublicTrip } from "@/lib/store";

export default function JoinClient({ tripId, tripData }: { tripId: string; tripData: PublicTrip }) {
  return <JoinFlow tripId={tripId} initialTrip={tripData} />;
}
