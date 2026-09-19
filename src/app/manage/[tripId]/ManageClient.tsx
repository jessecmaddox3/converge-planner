"use client";

import ManageTrip from "@/components/converge/ManageTrip";

export default function ManageClient({ tripId }: { tripId: string }) {
  return <ManageTrip tripId={tripId} />;
}
