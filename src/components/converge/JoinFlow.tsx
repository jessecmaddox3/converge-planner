"use client";
import {identityFetch} from "@/components/identity-fetch";
import { downloadCalendarFile } from "@/lib/calendar-download";

import { useEffect, useMemo, useRef, useState } from "react";
import { signIn, useSession } from "@/components/auth-client";
import {
  captureCapabilityFragment,
  getOrCreateRespondentCapability,
  getStoredRespondentCapability,
  privateReturnUrl,
} from "@/lib/respondent-capability";
import type {
  OwnTripResponse,
  PublicTrip,
  PublicTripResponse,
  ViewerRole,
  ViewerState,
} from "@/lib/store";
import { answersForDates, type DateAnswer } from "@/lib/availability";
import { addCalendarDays } from "@/lib/calendar/range";
import { enrichWindowsWithEvents, scoreCalendarEvent } from "@/lib/analysis";
import { detectAwaySpans } from "@/lib/calendar/away";
import { parseAvailability } from "@/lib/trip-validation";
import { useCalendarScan } from "./useCalendarScan";
import { PrivateCalendarCheck } from "./PrivateCalendarCheck";
import { CalendarConnection } from "./CalendarConnection";
import { AvailabilityChoices } from "./AvailabilityChoices";
import { TripShell, TripHeading } from "./TripShell";
import type { DatePreference } from "@/lib/trip-validation";
import {
  apiErrorMessage,
  dateRangeLabel,
  exactDateRange,
  optionYears,
  longDate,
  manageTripPath,
} from "@/components/converge/trip-client";

function capabilityHeaders(capability: string | null): Record<string, string> {
  return capability ? { Authorization: `Capability ${capability}` } : {};
}

async function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function normalizedPreferences(
  response: PublicTripResponse | null,
): Record<string, DatePreference> {
  if (!response) return {};
  const preferences: Record<string, DatePreference> = {};
  for (const date of response.selectedDates) {
    preferences[date] = response.preferences[date] || "available";
  }
  return preferences;
}

export default function JoinFlow({
  tripId,
  initialTrip,
}: {
  tripId: string;
  initialTrip: PublicTrip;
}) {
  const { data: session, status: authStatus } = useSession();
  const [trip, setTrip] = useState(initialTrip);
  const [role, setRole] = useState<ViewerRole>("viewer");
  const [ownResponse, setOwnResponse] = useState<PublicTripResponse | null>(
    null,
  );
  const [capability, setCapability] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, DateAnswer>>({});
  const [preferences, setPreferences] = useState<
    Record<string, DatePreference>
  >({});
  const [conflictCount, setConflictCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showReturnLink, setShowReturnLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const resumeCalendar = useRef(false);
  const calendar = useCalendarScan(
    {
      startDate: trip.startDate,
      endDate: trip.endDate,
      timeZone:
        trip.timeZone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC",
    },
    authStatus === "authenticated",
    session?.user?.email || "account",
  );
  const draftKey = `converge:join-calendar-draft:${tripId}`;
  const identityKey = `converge:join-private-identity:${tripId}`;
  useEffect(() => {
    if (authStatus === "authenticated" && resumeCalendar.current) {
      resumeCalendar.current = false;
      void calendar.connect();
    }
  }, [authStatus, loading, calendar.connect]);

  useEffect(() => {
    if (authStatus === "loading") return;

    let active = true;
    let viewerCapability: string | null = null;
    setLoading(true);
    setError("");

    try {
      viewerCapability = captureCapabilityFragment(
        tripId,
        window.location,
        window.history,
      );
      const identityMode =
        authStatus === "authenticated"
          ? `capability:${session?.user?.email?.toLowerCase() || ""}`
          : "capability";
      if (viewerCapability)
        window.localStorage.setItem(identityKey, identityMode);
      if (!viewerCapability && authStatus === "unauthenticated")
        viewerCapability = getOrCreateRespondentCapability(tripId);
      if (!viewerCapability && authStatus === "authenticated") {
        const storedMode = window.localStorage.getItem(identityKey);
        const storedCapability = getStoredRespondentCapability(tripId);
        let resuming = false;
        try {
          const pending = JSON.parse(
            window.localStorage.getItem(draftKey) || "null",
          );
          resuming = Boolean(
            pending &&
            pending.expires > Date.now() &&
            pending.capability === storedCapability &&
            (!pending.accountEmail ||
              pending.accountEmail === session?.user?.email),
          );
        } catch {
          /* An invalid draft cannot select a private identity. */
        }
        if (
          storedMode === identityMode ||
          (storedMode === "capability" && resuming)
        ) {
          viewerCapability = storedCapability;
          if (viewerCapability)
            window.localStorage.setItem(identityKey, identityMode);
        }
      }
    } catch {
      if (authStatus === "authenticated" && !window.location.hash) {
        viewerCapability = null;
      } else {
        setLoading(false);
        setError(
          "Private return storage is unavailable. Enable browser storage or sign in before responding.",
        );
        return;
      }
    }

    setCapability(viewerCapability);
    identityFetch(`/api/trips/${encodeURIComponent(tripId)}/me`, {
      cache: "no-store",
      headers: capabilityHeaders(viewerCapability),
    })
      .then(async (response) => {
        const payload = await responsePayload(response);
        if (!response.ok) {
          throw new Error(
            apiErrorMessage(payload, "Could not load your response"),
          );
        }
        return payload as ViewerState;
      })
      .then((viewer) => {
        if (!active) return;
        setTrip(viewer.trip);
        setRole(viewer.role);
        setOwnResponse(viewer.response);
        setName(viewer.response?.name || session?.user?.name || "");
        setEmail(viewer.response?.email || session?.user?.email || "");
        setPreferences(normalizedPreferences(viewer.response));
        setAnswers(answersForDates(viewer.response, viewer.trip.selectedDates));
        setConflictCount(viewer.response?.conflictCount || 0);
        setShowReturnLink(Boolean(viewerCapability && viewer.response));
        try {
          const pending = JSON.parse(
            window.localStorage.getItem(draftKey) || "null",
          );
          if (
            pending &&
            pending.capability === viewerCapability &&
            (!pending.accountEmail ||
              pending.accountEmail === session?.user?.email) &&
            pending.expires > Date.now() &&
            authStatus === "authenticated"
          ) {
            const recovered = parseAvailability(pending.response, {
              ...viewer.trip,
              confirmedDate: null,
            });
            setName(pending.name || session?.user?.name || recovered.name);
            setEmail(session?.user?.email || recovered.email || "");
            setAnswers(recovered.answers || {});
            setPreferences(recovered.preferences);
            resumeCalendar.current = true;
            window.localStorage.removeItem(draftKey);
          }
        } catch {
          /* Ignore an invalid or expired optional draft. */
        }
      })
      .catch((reason) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load your response",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    authStatus,
    loadAttempt,
    session?.user?.email,
    session?.user?.name,
    tripId,
  ]);

  const dates = useMemo(
    () => [...trip.selectedDates].sort(),
    [trip.selectedDates],
  );
  const selectedDates = useMemo(
    () => dates.filter((date) => answers[date] === "available"),
    [answers, dates],
  );
  const answeredCount = dates.filter((date) => answers[date]).length;

  function chooseAnswer(date: string, answer?: DateAnswer) {
    setAnswers((current) => {
      const next = { ...current };
      if (answer) next[date] = answer;
      else delete next[date];
      return next;
    });
    setPreferences((current) => {
      const next = { ...current };
      if (answer === "available") next[date] = current[date] || "available";
      else delete next[date];
      return next;
    });
  }

  function noneWork() {
    setAnswers(
      Object.fromEntries(dates.map((date) => [date, "unavailable" as const])),
    );
    setPreferences({});
  }

  async function saveAvailability() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNotice("Enter your name before saving.");
      return;
    }

    // Check the address here rather than relying on the server's rejection. The route maps a
    // bad email to the shared INVALID_INPUT code, whose message reads "Trip request is
    // semantically invalid" — accurate but useless to someone who just fat-fingered a domain.
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setNotice(
        "That email does not look right. Fix it, or clear it to skip the update.",
      );
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const headers = {
        "Content-Type": "application/json",
        ...capabilityHeaders(capability),
      };
      const body = {
        name: trimmedName,
        selectedDates,
        preferences,
        conflictCount,
        email: email.trim(),
        answerVersion: 2,
        answers,
      };
      const response = await identityFetch(
        `/api/trips/${encodeURIComponent(tripId)}/availability`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(body),
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          apiErrorMessage(payload, "Could not save your availability"),
        );
      }
      const saved = (payload as { response: OwnTripResponse }).response;
      setOwnResponse(saved);
      setRole("respondent");
      setTrip((current) => {
        const existingIndex = current.responses.findIndex(
          (responseItem) => responseItem.publicId === saved.publicId,
        );
        const responses = [...current.responses];
        if (existingIndex >= 0) responses[existingIndex] = saved;
        else responses.push(saved);
        return { ...current, responses };
      });
      setName(saved.name);
      // Reflects the address actually stored, which may differ from what was
      // typed: a signed-in actor's session email always wins server-side.
      setEmail(saved.email || "");
      setPreferences(normalizedPreferences(saved));
      setAnswers(answersForDates(saved, trip.selectedDates));
      setConflictCount(saved.conflictCount);
      setShowReturnLink(Boolean(capability));
      if (capability) {
        try {
          window.localStorage.setItem(
            identityKey,
            authStatus === "authenticated"
              ? `capability:${session?.user?.email?.toLowerCase() || ""}`
              : "capability",
          );
        } catch {
          /* The return token itself is already stored. */
        }
      }
      setNotice(
        ownResponse
          ? "Your availability is updated."
          : "Your availability is saved.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Could not save your availability",
      );
    } finally {
      setSaving(false);
    }
  }

  async function connectCalendar(reconnect = false) {
    if (authStatus === "authenticated" && !reconnect) {
      await calendar.connect();
      return;
    }
    try {
      if (capability)
        window.localStorage.setItem(
          identityKey,
          authStatus === "authenticated"
            ? `capability:${session?.user?.email?.toLowerCase() || ""}`
            : "capability",
        );
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          capability,
          accountEmail:
            authStatus === "authenticated" ? session?.user?.email : undefined,
          name,
          expires: Date.now() + 1800000,
          response: {
            name: name.trim() || "Guest",
            email,
            answers,
            answerVersion: 2,
            preferences,
            selectedDates,
            conflictCount,
          },
        }),
      );
    } catch {
      setNotice(
        "Save your answers before connecting your calendar. Browser draft storage is unavailable.",
      );
      return;
    }
    await signIn("google", { callbackUrl: window.location.href });
  }

  async function copyPrivateLink() {
    if (!capability) return;
    try {
      const url = privateReturnUrl(tripId, capability, window.location.origin);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNotice("Private return link copied. Keep it somewhere safe.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice(
        "Copy failed. Keep this browser available to return to your response.",
      );
    }
  }

  const confirmedDate = trip.status === "confirmed" ? trip.confirmedDate : null;
  const isConfirmed = confirmedDate !== null;

  const privateChecks = useMemo(
    () =>
      calendar.result
        ? enrichWindowsWithEvents(
            dates.map((date) => ({
              start: date,
              end: addCalendarDays(date, trip.duration - 1),
            })),
            calendar.result.current.events.map(scoreCalendarEvent),
            [],
            calendar.result.current.coverage,
            detectAwaySpans(calendar.result.current.events),
            {
              ...trip,
              timeZone:
                trip.timeZone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                "UTC",
            },
          )
        : [],
    [
      calendar.result,
      dates,
      trip.duration,
      trip.timeZone,
      trip.departureTime,
      trip.returnTime,
    ],
  );
  const closed = trip.invitationsClosed === true;
  return (
    <TripShell
      narrow
      navigation={
        <span className="muted">
          Invited by {trip.organizerName || "the organizer"}
        </span>
      }
    >
      <TripHeading
        title={trip.name}
        detail={`${trip.selectedDates.length} date options for a ${trip.duration}-day trip · ${optionYears(trip)}`}
      />
      {capability && authStatus === "authenticated" && ownResponse && (
        <p className="notice small" style={{ marginBottom: 20 }}>
          Editing {ownResponse.name}’s saved response using its private return
          link. Confirmation emails go to your signed-in address,{" "}
          {session?.user?.email}.
        </p>
      )}
      {trip.notes && <p className="trip-notes">{trip.notes}</p>}
      {trip.departureTime || trip.returnTime ? (
        <p className="notice small" style={{ marginBottom: 24 }}>
          Depart {trip.departureTime || "at the start of the day"}; return{" "}
          {trip.returnTime || "at the end of the day"}. Times in{" "}
          {trip.timeZone?.replaceAll("_", " ")}.
        </p>
      ) : (
        <p className="muted small" style={{ marginBottom: 24 }}>
          Each option includes the whole day
          {trip.duration > 1 ? " on its first and last dates" : ""}.
        </p>
      )}
      {loading && (
        <section className="loading-state" role="status">
          Loading your response…
        </section>
      )}
      {error && !loading && (
        <section className="notice error">
          <h2>We could not restore your response</h2>
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            style={{ marginTop: 14 }}
          >
            Try again
          </button>
        </section>
      )}
      {!loading && !error && role === "organizer" && (
        <section className="panel stack">
          <h2>You organized this trip</h2>
          <p className="muted">
            Share the invitation and compare everyone’s answers on your trip
            page.
          </p>
          <a className="button" href={manageTripPath(tripId)}>
            Manage trip
          </a>
        </section>
      )}
      {!loading && !error && isConfirmed && role !== "organizer" && (
        <section className="panel">
          <span className="badge">Trip confirmed</span>
          <h2 className="confirmation-date">{longDate(confirmedDate)}</h2>
          <p>{exactDateRange(confirmedDate, trip.duration)}</p>
          <button
            type="button"
            className="button"
            style={{ marginTop: 16 }}
            onClick={() => downloadCalendarFile(trip)}
          >
            Add to calendar
          </button>
          {ownResponse && (
            <p className="muted small" style={{ marginTop: 16 }}>
              Your saved response is now read-only.
            </p>
          )}
        </section>
      )}
      {!loading && !error && !isConfirmed && role !== "organizer" && (
        <>
          {closed && (
            <p className="notice warning" style={{ marginBottom: 20 }}>
              The organizer has closed responses. Your saved answers are shown
              below.
            </p>
          )}
          {!closed && (
            <details className="private-calendar">
              <summary>
                Check my calendar <span className="muted">(optional)</span>
              </summary>
              <CalendarConnection
                calendar={calendar}
                onConnect={() => void connectCalendar()}
                onReconnect={() => void connectCalendar(true)}
                privateMode
              />
            </details>
          )}
          <section aria-labelledby="answer-title">
            <div className="section-heading">
              <div>
                <h2 id="answer-title">Which dates work for you?</h2>
                <p>
                  Answer each option. You can leave a date unanswered and come
                  back to it.
                </p>
              </div>
            </div>
            <div className="answer-list">
              {dates.map((date) => (
                <AvailabilityChoices
                  key={date}
                  date={date}
                  duration={trip.duration}
                  answer={answers[date]}
                  favorite={preferences[date] === "preferred"}
                  disabled={closed || saving}
                  calendarDetails={
                    <PrivateCalendarCheck
                      check={privateChecks.find(
                        (check) => check.start === date,
                      )}
                    />
                  }
                  onAnswer={(answer) => chooseAnswer(date, answer)}
                  onFavorite={() =>
                    setPreferences((current) => ({
                      ...current,
                      [date]:
                        current[date] === "preferred"
                          ? "available"
                          : "preferred",
                    }))
                  }
                />
              ))}
            </div>
            {!closed && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  alignItems: "center",
                  margin: "12px 0 24px",
                }}
              >
                <small className="muted">
                  Favorite marks an available date you like best.
                </small>
                <button
                  type="button"
                  className="text-button"
                  style={{ flexShrink: 0 }}
                  disabled={saving}
                  onClick={noneWork}
                >
                  None work for me
                </button>
              </div>
            )}
          </section>
          {!closed && (
            <>
              <section className="panel form-grid" aria-label="Your details">
                <div className="field">
                  <label htmlFor="respondent-name">Your name</label>
                  <input
                    id="respondent-name"
                    autoComplete="name"
                    value={name}
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="respondent-email">Email (optional)</label>
                  <input
                    id="respondent-email"
                    autoComplete="email"
                    type="email"
                    value={email}
                    maxLength={200}
                    placeholder="you@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <small>
                    For the date confirmation. Only you and the organizer can
                    see it.
                  </small>
                </div>
              </section>
              <div className="save-bar">
                <div>
                  <strong>
                    {answeredCount} of {dates.length} answered
                  </strong>
                  <small>
                    {answeredCount === dates.length
                      ? "Ready to share your answers"
                      : "Unanswered dates stay undecided"}
                  </small>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={saving || !name.trim()}
                  onClick={() => void saveAvailability()}
                >
                  {saving
                    ? "Saving…"
                    : ownResponse
                      ? "Update availability"
                      : "Save availability"}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {notice && (
        <div className="notice" role="status" style={{ marginTop: 16 }}>
          {notice}
        </div>
      )}
      {!loading && !error && showReturnLink && capability && (
        <section className="return-link">
          <h3>Keep your private return link</h3>
          <p>
            Use it to edit your answers on another device. Anyone with this link
            can update your response.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void copyPrivateLink()}
          >
            {copied ? "Private link copied" : "Copy my private return link"}
          </button>
        </section>
      )}
      {!loading && !error && (ownResponse || isConfirmed) && (
        <section className="group-responses">
          <h2>Who has weighed in</h2>
          <ul>
            {trip.responses.map((response) => {
              const saved = answersForDates(response, trip.selectedDates);
              const count = Object.values(saved).filter(
                (answer) => answer === "available",
              ).length;
              const answered = Object.keys(saved).length;
              return (
                <li key={response.publicId}>
                  <strong>{response.name}</strong>
                  <span>
                    {count} available
                    {answered < dates.length
                      ? `, ${dates.length - answered} unanswered`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </TripShell>
  );
}
