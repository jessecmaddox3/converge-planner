"use client";
import {identityFetch} from "@/components/identity-fetch";
import { downloadCalendarFile } from "@/lib/calendar-download";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {useRuntime} from "@/components/RuntimeContext";
import { signIn, useSession } from "@/components/auth-client";
import { TripShell, TripHeading } from "./TripShell";
import { AvailabilityMatrix } from "./AvailabilityMatrix";
import { ExpectedPeople } from "./ExpectedPeople";
import { answerFor } from "@/lib/availability";
import { emptyPlanning } from "@/lib/trip-planning";
import {
  apiErrorMessage,
  candidateTallies,
  dateRangeLabel,
  exactDateRange,
  optionYears,
  joinTripPath,
  longDate,
  manageTripPath,
  shortDate,
} from "@/components/converge/trip-client";

async function requestJson(url, init) {
  const response = await identityFetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(payload, `Request failed (HTTP ${response.status})`),
    );
  }
  return payload;
}

function CenteredStatus({ title, detail, action }) {
  return (
    <TripShell narrow>
      <section className="panel stack" style={{ marginTop: 40 }}>
        <h1>{title}</h1>
        <p className="muted">{detail}</p>
        {action}
      </section>
    </TripShell>
  );
}

export default function ManageTrip({ tripId }) {
  const {notificationMode,mode} = useRuntime();
  const { status } = useSession();
  const redirectedRef = useRef(false);
  const confirmationHeading = useRef(null);
  const focusConfirmation = useRef(false);
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const [deliveryCheck, setDeliveryCheck] = useState(0);

  const loadTrip = useCallback(
    async (showNotice = false) => {
      if (!showNotice) setLoading(true);
      else setAction("refreshing");
      setError("");
      try {
        const managedTrip = await requestJson(
          `/api/trips/${encodeURIComponent(tripId)}/manage`,
          { cache: "no-store" },
        );
        setTrip(managedTrip);
        setNotifications(managedTrip.notifications || null);
        setSelectedDate(
          (current) =>
            managedTrip.confirmedDate ||
            (managedTrip.selectedDates.includes(current)
              ? current
              : candidateTallies(managedTrip)[0]?.date || ""),
        );
        setReviewing(false);
        if (showNotice) setNotice("Responses refreshed.");
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Could not load this trip";
        if (showNotice) setNotice(message);
        else setError(message);
      } finally {
        setLoading(false);
        if (showNotice) setAction("");
      }
    },
    [tripId],
  );

  useEffect(() => {
    if (status === "unauthenticated" && !redirectedRef.current) {
      redirectedRef.current = true;
      const callbackUrl =
        typeof window === "undefined"
          ? manageTripPath(tripId)
          : `${window.location.origin}${manageTripPath(tripId)}`;
      void signIn("google", { callbackUrl });
      return;
    }
    if (status === "authenticated") void loadTrip();
  }, [loadTrip, status, tripId]);

  const tallies = useMemo(() => (trip ? candidateTallies(trip) : []), [trip]);

  async function copyInviteLink() {
    const url = `${window.location.origin}${joinTripPath(tripId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNotice("Invite link copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy failed. Select the invite URL and copy it manually.");
    }
  }

  useEffect(() => {
    if (focusConfirmation.current && trip?.status === "confirmed") {
      focusConfirmation.current = false;
      confirmationHeading.current?.focus({ preventScroll: true });
      confirmationHeading.current?.scrollIntoView?.({ block: "center" });
    }
  }, [trip]);

  useEffect(() => {
    if (trip?.status !== "confirmed") return;
    const controller = new AbortController();
    let finished = false;
    const timers = [2000, 8000, 20000].map((delay) =>
      setTimeout(async () => {
        if (finished) return;
        try {
          const refreshed = await requestJson(
            `/api/trips/${encodeURIComponent(tripId)}/manage`,
            { cache: "no-store", signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (
            refreshed.status !== "confirmed" ||
            refreshed.confirmationVersion !== trip.confirmationVersion
          ) {
            finished = true;
            void loadTrip();
            return;
          }
          setNotifications(refreshed.notifications || null);
          finished = !refreshed.notifications?.pending;
        } catch {
          /* Keep the saved confirmation and offer manual refresh. */
        }
      }, delay),
    );
    return () => {
      controller.abort();
      timers.forEach(clearTimeout);
    };
  }, [
    trip?.status,
    trip?.confirmationVersion,
    tripId,
    deliveryCheck,
    loadTrip,
  ]);

  async function confirmDate(date, retry = false) {
    if (!date) return;
    setAction(retry ? "retrying" : "confirming");
    setNotice("");
    try {
      const result = await requestJson(
        `/api/trips/${encodeURIComponent(tripId)}/confirmation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmedDate: date }),
        },
      );
      focusConfirmation.current = !retry;
      setTrip(result.trip);
      setSelectedDate(result.confirmedDate);
      setReviewing(false);
      setNotifications(result.notifications || null);
      setDeliveryCheck((value) => value + 1);
      setNotice(
        notificationMode === 'preview' ? "Trip confirmed. Local previews are being prepared; nothing is emailed." : notificationMode === 'disabled' ? "Trip confirmed. Email is disabled; share the trip link yourself." : retry || result.alreadyConfirmed
          ? "Delivery check queued. Failed emails retry automatically after a short wait."
          : result.notifications?.total ? "Trip confirmed. Confirmation emails are being delivered." : "Trip confirmed. Share the trip link to let everyone know.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Could not confirm this trip",
      );
    } finally {
      setAction("");
    }
  }

  async function reopen() {
    setAction("reopening");
    setNotice("");
    try {
      const reopened = await requestJson(
        `/api/trips/${encodeURIComponent(tripId)}/reopen`,
        { method: "POST" },
      );
      setTrip(reopened);
      setSelectedDate((current) =>
        reopened.selectedDates.includes(current)
          ? current
          : candidateTallies(reopened)[0]?.date || "",
      );
      setNotifications(null);
      setReviewing(false);
      setNotice("Availability is open again.");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Could not reopen this trip",
      );
    } finally {
      setAction("");
    }
  }

  async function updatePlanning(planning) {
    setAction("settings");
    setNotice("");
    try {
      const updated = await requestJson(
        `/api/trips/${encodeURIComponent(tripId)}/planning`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(planning),
        },
      );
      setTrip(updated);
      setReviewing(false);
      return true;
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Could not save trip settings",
      );
      return false;
    } finally {
      setAction("");
    }
  }

  if (status === "loading" || loading || status === "unauthenticated")
    return (
      <CenteredStatus
        title={
          status === "unauthenticated"
            ? "Taking you to sign in"
            : "Loading trip"
        }
        detail={mode === "demo" ? "Choose the demo persona that created this trip." : "Use the Google account that created this trip."}
      />
    );
  if (error || !trip)
    return (
      <CenteredStatus
        title="We could not open this trip"
        detail={error || "The trip is unavailable."}
        action={
          <button
            type="button"
            onClick={() => void loadTrip()}
            className="button"
          >
            Try again
          </button>
        }
      />
    );
  const isConfirmed = trip.status === "confirmed" && trip.confirmedDate;
  const planning = trip.planning || emptyPlanning();
  const chosen = tallies.find((tally) => tally.date === selectedDate);
  const unavailable = trip.responses.filter(
    (response) => answerFor(response, selectedDate) === "unavailable",
  );
  const maybe = trip.responses.filter(
    (response) => answerFor(response, selectedDate) === "maybe",
  );
  const unanswered = trip.responses.filter(
    (response) => answerFor(response, selectedDate) === "unanswered",
  );
  const expected = planning.expectedPeople.filter(
    (person) =>
      !trip.responses.some(
        (response) => response.publicId === person.responsePublicId,
      ),
  );
  return (
    <TripShell
      navigation={
        <button
          type="button"
          className="button secondary"
          aria-label="Refresh responses"
          disabled={Boolean(action)}
          onClick={() => void loadTrip(true)}
        >
          {action === "refreshing" ? "Refreshing…" : "Refresh responses"}
        </button>
      }
    >
      <TripHeading
        title={trip.name}
        detail={`${trip.duration}-day trip. ${trip.responses.length} ${trip.responses.length === 1 ? "person has" : "people have"} answered. ${optionYears(trip)}.`}
      >
        <span
          className={`badge ${planning.invitationsClosed ? "warning" : ""}`}
        >
          {isConfirmed
            ? "Date chosen"
            : planning.invitationsClosed
              ? "Responses closed"
              : "Collecting answers"}
        </span>
      </TripHeading>
      {trip.notes && <p className="trip-notes">{trip.notes}</p>}
      <section className="share-strip" aria-label="Sharing">
        <div>
          <strong>Invite your people</strong>
          <label className="sr-only" htmlFor="invite-link">
            Invite link
          </label>
          <input
            id="invite-link"
            readOnly
            value={
              typeof window === "undefined"
                ? joinTripPath(tripId)
                : `${window.location.origin}${joinTripPath(tripId)}`
            }
            onFocus={(event) => event.target.select()}
          />
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => void copyInviteLink()}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </section>
      {notice && (
        <div className="notice" role="status" style={{ margin: "16px 0" }}>
          {notice}
        </div>
      )}
      {isConfirmed && (
        <section className="confirmed-panel">
          <div>
            <span className="badge">Trip confirmed</span>
            <h2
              className="confirmation-date"
              ref={confirmationHeading}
              tabIndex={-1}
            >
              {longDate(trip.confirmedDate)}
            </h2>
            <p>{exactDateRange(trip.confirmedDate, trip.duration)}</p>
            {notifications && (
              <p className="muted small" style={{ marginTop: 12 }}>
                {notificationMode === "preview" ? "Local previews:" : notificationMode === "disabled" ? "Email disabled:" : "Email delivery:"} {notifications.sent} {notificationMode === "preview" ? "saved" : "sent"},{" "}
                {notifications.pending} pending
                {notifications.failed ? `, ${notifications.failed} failed` : ""}
                .
                {notifications.failed > 0 && (
                  <span>
                    {" "}
                    Failed deliveries retry automatically, up to eight attempts.
                    You can also share the trip link directly.
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="stack">
            {mode === 'demo' && <a className="button secondary" href={'/demo/outbox/' + tripId}>Open preview outbox</a>}
            <button
              type="button"
              className="button"
              onClick={() => downloadCalendarFile(trip)}
            >
              Add to calendar
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={Boolean(action)}
              onClick={() => void confirmDate(trip.confirmedDate, true)}
            >
              {action === "retrying" ? "Retrying…" : notificationMode === "preview" ? "Check local previews" : "Check email delivery"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={Boolean(action)}
              onClick={() => void reopen()}
            >
              {action === "reopening" ? "Reopening…" : "Reopen availability"}
            </button>
          </div>
        </section>
      )}
      <section style={{ marginTop: 30 }} aria-labelledby="comparison-title">
        <div className="section-heading">
          <div>
            <h2 id="comparison-title">Find the best fit for everyone</h2>
            <p>
              Required people first, then how many can attend. Favorites break a
              tie.
            </p>
          </div>
          <span className="badge">
            {trip.responses.length}{" "}
            {trip.responses.length === 1 ? "response" : "responses"}
          </span>
        </div>
        <AvailabilityMatrix
          trip={trip}
          selectedDate={selectedDate}
          onSelect={(date) => {
            setSelectedDate(date);
            setReviewing(false);
          }}
          disabled={Boolean(action) || Boolean(isConfirmed)}
          onRequiredChange={(id, required) =>
            void updatePlanning({
              ...planning,
              requiredResponseIds: required
                ? [...planning.requiredResponseIds, id]
                : planning.requiredResponseIds.filter((value) => value !== id),
            })
          }
        />
        <p className="muted small matrix-help">
          Each column is an exact option. Slide across to compare dates.
          “Required” means that person’s availability comes first.
        </p>
      </section>
      {!isConfirmed && chosen && (
        <section className="decision-panel" aria-labelledby="decision-title">
          <div>
            <h2 id="decision-title">
              {dateRangeLabel(selectedDate, trip.duration)}
            </h2>
            <p className="muted" style={{ marginTop: 8 }}>
              {chosen.reason}.
            </p>
            {chosen.preferredCount > 0 && (
              <p className="small" style={{ marginTop: 6 }}>
                ★ {chosen.preferredCount}{" "}
                {chosen.preferredCount === 1 ? "favorite" : "favorites"}
              </p>
            )}
          </div>
          {!reviewing ? (
            <button
              type="button"
              className="button"
              aria-label={`Review ${shortDate(selectedDate)}`}
              disabled={Boolean(action)}
              onClick={() => setReviewing(true)}
            >
              Review this date
            </button>
          ) : (
            <div className="confirmation-review">
              <h3>Before you confirm</h3>
              <p>{exactDateRange(selectedDate, trip.duration)}</p>
              <p className="muted small" style={{ margin: "8px 0 14px" }}>
                {notificationMode === 'preview' ? "This creates local email previews for respondents with contact addresses. Nothing is sent." : notificationMode === 'disabled' ? "Email is disabled for this installation. Share the trip link yourself after confirming." : "Respondents who supplied an email address will be notified. The expected-person roster does not receive invitations."} Availability is not an attendance RSVP.
              </p>
              {trip.departureTime || trip.returnTime ? (
                <p className="small">
                  Depart {trip.departureTime || "at the start of the day"};
                  return {trip.returnTime || "at the end of the day"}.{" "}
                  {trip.timeZone?.replaceAll("_", " ")}.
                </p>
              ) : (
                <p className="small">
                  Whole days, including the first and last date.
                </p>
              )}
              {trip.responses.length === 0 && (
                <p className="notice warning">No one has responded yet.</p>
              )}
              {unavailable.length > 0 && (
                <p className="notice error">
                  Cannot attend:{" "}
                  {unavailable.map((response) => response.name).join(", ")}.
                </p>
              )}
              {maybe.length > 0 && (
                <p className="notice warning">
                  Maybe: {maybe.map((response) => response.name).join(", ")}.
                </p>
              )}
              {(unanswered.length > 0 || expected.length > 0) && (
                <p className="notice warning">
                  Unanswered:{" "}
                  {[
                    ...unanswered.map((response) => response.name),
                    ...expected.map((person) => person.name),
                  ].join(", ")}
                  .
                </p>
              )}
              {chosen.eligibility === "blocked" && (
                <p className="small">
                  A required person cannot attend. Confirming this date makes an
                  exception to that requirement.
                </p>
              )}
              <div className="decision-actions">
                <button
                  type="button"
                  className={`button ${chosen.eligibility === "blocked" ? "danger" : ""}`}
                  disabled={Boolean(action)}
                  aria-label={`Confirm ${shortDate(selectedDate)}`}
                  onClick={() => void confirmDate(selectedDate)}
                >
                  {action === "confirming"
                    ? "Confirming…"
                    : chosen.eligibility === "blocked"
                      ? (notificationMode === "preview" ? "Confirm anyway and create previews" : notificationMode === "disabled" ? "Confirm this date anyway" : "Confirm anyway and notify group")
                      : (notificationMode === "preview" ? "Confirm date and create previews" : notificationMode === "disabled" ? "Confirm this date" : "Confirm date and notify group")}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={Boolean(action)}
                  onClick={() => setReviewing(false)}
                >
                  Keep comparing
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {!isConfirmed && (
        <>
          <ExpectedPeople
            trip={trip}
            disabled={Boolean(action)}
            onChange={updatePlanning}
          />
          <div className="close-invitations">
            <p className="muted small">
              {planning.invitationsClosed
                ? "People can view the invitation, but cannot change their answers."
                : "Close responses when you have everything you need. You can open them again."}
            </p>
            <button
              type="button"
              className="text-button"
              disabled={Boolean(action)}
              onClick={() =>
                void updatePlanning({
                  ...planning,
                  invitationsClosed: !planning.invitationsClosed,
                })
              }
            >
              {planning.invitationsClosed
                ? "Open responses"
                : "Close responses"}
            </button>
          </div>
        </>
      )}
    </TripShell>
  );
}
