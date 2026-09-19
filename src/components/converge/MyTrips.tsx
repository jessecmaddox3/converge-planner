"use client";
import {identityFetch} from "@/components/identity-fetch";

import { useEffect, useState } from "react";
import { useSession } from "@/components/auth-client";
import type { TripSummary } from "@/lib/store";
import {
  apiErrorMessage,
  dateRangeLabel,
  shortDate,
  tripSummaryPath,
} from "@/components/converge/trip-client";

const colors = {
  card: "#FFFFFF",
  primary: "#1B4332",
  primaryPale: "#E8F5EE",
  accentLight: "#FFF3DC",
  text: "#2D2D2D",
  textMuted: "#6B7280",
  border: "#E5E1DB",
};

export default function MyTrips() {
  const { status, data: session } = useSession();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "authenticated") {
      setTrips([]);
      setLoading(false);
      setError("");
      return;
    }

    let active = true;
    setTrips([]);
    setLoading(true);
    setError("");
    identityFetch("/api/trips?mine=1", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiErrorMessage(payload, "Could not load your trips"));
        }
        return payload as { trips?: TripSummary[] };
      })
      .then((payload) => {
        if (active) setTrips(Array.isArray(payload.trips) ? payload.trips : []);
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Could not load your trips");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [status, session?.user?.actorId]);

  if (status !== "authenticated") return null;

  return (
    <section
      aria-labelledby="my-trips-title"
      style={{
        marginBottom: 24,
        padding: 18,
        border: `1px solid ${colors.border}`,
        borderRadius: 18,
        background: "linear-gradient(145deg, #FFFFFF 0%, #F7FBF8 100%)",
        boxShadow: "0 8px 24px rgba(27,67,50,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div
            style={{
              color: colors.textMuted,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Pick up where you left off
          </div>
          <h2
            id="my-trips-title"
            style={{
              margin: "3px 0 0",
              color: colors.primary,
              fontFamily: "'Fraunces', Georgia, serif",
              fontSize: 21,
            }}
          >
            My Trips
          </h2>
        </div>
        {loading ? (
          <span style={{ color: colors.textMuted, fontSize: 12 }}>Loading...</span>
        ) : null}
      </div>

      {error ? (
        <p style={{ margin: "12px 0 0", color: "#C0392B", fontSize: 12 }}>
          {error}
        </p>
      ) : null}

      {!loading && !error && trips.length === 0 ? (
        <p style={{ margin: "12px 0 0", color: colors.textMuted, fontSize: 13 }}>
          Saved trips will appear here after you share your first set of dates.
        </p>
      ) : null}

      {trips.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {trips.map((trip) => (
            <a
              key={trip.id}
              href={tripSummaryPath(trip)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "11px 12px",
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                background: colors.card,
                color: colors.text,
                textDecoration: "none",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    overflow: "hidden",
                    fontSize: 13,
                    fontWeight: 700,
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {trip.name}
                </span>
                <span style={{ color: colors.textMuted, fontSize: 11 }}>
                  {trip.confirmedDate ? dateRangeLabel(trip.confirmedDate, trip.duration) : `${shortDate(trip.startDate)} to ${shortDate(trip.endDate)}`}
                </span>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: trip.status === "confirmed"
                    ? colors.accentLight
                    : colors.primaryPale,
                  color: colors.primary,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {trip.status === "confirmed"
                  ? "Confirmed"
                  : trip.role === "organizer"
                    ? "Manage"
                    : "Respond"}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
