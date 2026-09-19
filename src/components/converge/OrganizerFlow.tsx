"use client";

import {useRuntime} from "@/components/RuntimeContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "@/components/auth-client";
import {
  generateRecommendedWindows,
  scoreCalendarEvent,
  type AnalyzedEvent,
} from "@/lib/analysis";
import { detectAwaySpans } from "@/lib/calendar/away";
import { compareWindows, suggestDiverseWindows } from "@/lib/scheduling";
import {
  DRAFT_KEY,
  draftError,
  initialDraft,
  readDraft,
  serializeDraft,
  updateDraft,
  type TripDraft,
} from "@/lib/trip-draft";
import { TripShell, TripHeading } from "./TripShell";
import { TripSetup } from "./TripSetup";
import { DateExplorer } from "./DateExplorer";
import { OptionDetails } from "./OptionDetails";
import { CalendarConnection } from "./CalendarConnection";
import { calendarJson, useCalendarScan } from "./useCalendarScan";
import { assignManagedTrip, dateRangeLabel } from "./trip-client";
import { HistoryPanel } from "./HistoryPanel";
import MyTrips from "./MyTrips";

export default function OrganizerFlow() {
  const {mode}=useRuntime();
  const { data: session, status } = useSession();
  const [draft, setDraft] = useState<TripDraft>(() => mode === "demo" ? {...initialDraft("2030-05-01"),name:"My studio getaway",endDate:"2030-06-30",timeZone:"Europe/London"} : initialDraft());
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [focused, setFocused] = useState("");
  const [overrides, setOverrides] = useState<
    Record<string, AnalyzedEvent["override"]>
  >({});
  const resumed = useRef(false);
  const calendar = useCalendarScan(
    draft,
    status === "authenticated",
    session?.user?.email || "account",
  );
  useEffect(() => {
    try {
      const recovered = readDraft(window.localStorage.getItem(DRAFT_KEY));
      if (recovered) setDraft(recovered);
    } catch {
      /* Browsing still works when storage is disabled. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        window.localStorage.setItem(DRAFT_KEY, serializeDraft(draft));
      } catch {
        /* Keep the active draft in memory. */
      }
    }
  }, [draft, ready]);
  useEffect(() => {
    if (ready && status === "authenticated" && !resumed.current) {
      resumed.current = true;
      try {
        if (
          window.sessionStorage.getItem("converge:connect-calendar") === "yes"
        ) {
          window.sessionStorage.removeItem("converge:connect-calendar");
          void calendar.connect();
        }
      } catch {
        /* Optional resume only. */
      }
    }
    setOverrides({});
  }, [ready, status, session?.user?.email, calendar.connect]);
  const windows = useMemo(() => {
    if (draftError(draft)) return [];
    const rawEvents = calendar.result?.current.events || [];
    const events = rawEvents.map((event) => ({
      ...scoreCalendarEvent(event),
      override: overrides[event.key],
    }));
    const result = generateRecommendedWindows(
      draft.startDate,
      draft.endDate,
      draft.duration,
      draft.durationPreset,
      events,
      [],
      calendar.result?.current.coverage,
      detectAwaySpans(rawEvents),
      draft,
    );
    if (draft.restDay)
      result.sort((a, b) => {
        const hard =
          (a.assessment?.hardBlockers || 0) -
            (b.assessment?.hardBlockers || 0) ||
          (a.assessment?.inferredBlockers || 0) -
            (b.assessment?.inferredBlockers || 0);
        const tight = (window: typeof a) =>
          window.travelAdjacency?.span.confidence === "high" &&
          window.travelAdjacency.gapDays < 1
            ? 1
            : 0;
        return hard || tight(a) - tight(b) || compareWindows(a, b);
      });
    return result;
  }, [draft, calendar.result, overrides]);
  const selected =
    windows.find((window) => window.start === focused) || windows[0];
  function change(value: Partial<TripDraft>) {
    setDraft((current) => updateDraft(current, value));
    setError("");
  }
  function inspect(date: string) {
    setFocused(date);
    if (window.matchMedia?.("(max-width: 680px)").matches)
      requestAnimationFrame(() => {
        const heading = document.getElementById("option-detail-title");
        heading?.focus({ preventScroll: true });
        heading
          ?.closest("aside")
          ?.scrollIntoView({ behavior: "instant", block: "start" });
      });
  }
  function reviewShortlist() {
    setShortlistOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById("shortlist-title")
        ?.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  }
  function toggle(date: string) {
    setDraft((current) => {
      const included = current.selectedDates.includes(date);
      if (!included && current.selectedDates.length >= 100) {
        setNotice(
          "You can propose up to 100 dates. A shortlist of 3 to 5 is easier for everyone to answer.",
        );
        return current;
      }
      return {
        ...current,
        selectedDates: included
          ? current.selectedDates.filter((item) => item !== date)
          : [...current.selectedDates, date].sort(),
      };
    });
  }
  function explore() {
    const issue = draftError(draft);
    setError(issue);
    if (!issue) {
      change({ exploring: true });
      setNotice("");
    }
  }
  async function connect(reconnect = false) {
    if (status === "authenticated" && !reconnect) {
      await calendar.connect();
      return;
    }
    try {
      window.localStorage.setItem(DRAFT_KEY, serializeDraft(draft));
      window.sessionStorage.setItem("converge:connect-calendar", "yes");
    } catch {
      /* The current draft remains available until navigation. */
    }
    await signIn("google", { callbackUrl: window.location.href });
  }
  async function createInvitation() {
    if (status !== "authenticated") {
      try {
        window.localStorage.setItem(DRAFT_KEY, serializeDraft(draft));
      } catch {
        /* Best effort draft recovery. */
      }
      await signIn("google", { callbackUrl: window.location.href });
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await calendarJson("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          startDate: draft.startDate,
          endDate: draft.endDate,
          duration: draft.duration,
          durationPreset: draft.durationPreset,
          notes: draft.notes,
          selectedDates: draft.selectedDates,
          timeZone: draft.timeZone,
          departureTime: draft.departureTime || undefined,
          returnTime: draft.returnTime || undefined,
        }),
      });
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* Invitation is already saved. */
      }
      assignManagedTrip(result.id, window.location);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the invitation. Please try again.",
      );
      setSaving(false);
    }
  }
  const navigation =
    status === "authenticated" ? (
      <details className="account-menu">
        <summary>
          {session?.user?.name?.split(" ")[0] || "Your account"}{" "}
          <span aria-hidden="true">⌄</span>
        </summary>
        <div>
          <p>{session?.user?.email}</p>
          <button
            className="text-button"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </details>
    ) : (
      <button
        className="button secondary"
        type="button"
        onClick={() =>
          void signIn("google", { callbackUrl: window.location.href })
        }
      >
        Sign in
      </button>
    );
  if (!ready)
    return (
      <TripShell navigation={navigation}>
        <p className="loading-state">Opening your planner…</p>
      </TripShell>
    );
  return (
    <TripShell navigation={navigation}>
      {!draft.exploring ? (
        <>
          <header className="planner-intro">
            <span className="eyebrow">Good company. A date that works.</span>
            <h1>
              Make time for
              <br />
              the next trip.
            </h1>
            <p>
              Find a few good dates, ask your people, and make a plan together.
            </p>
          </header>
          <div className="setup-layout">
            <TripSetup
              draft={draft}
              onChange={change}
              onExplore={explore}
              error={error}
            />
            <aside className="setup-aside">
              <div className="planning-steps">
                <span className="eyebrow">From someday to planned</span>
                <ol>
                  <li>
                    <strong>Find a few dates</strong>
                    <p>
                      Browse the calendar and check what’s already on yours.
                    </p>
                  </li>
                  <li>
                    <strong>Ask your people</strong>
                    <p>
                      Share a link. Everyone can say Available, Maybe, or
                      Cannot.
                    </p>
                  </li>
                  <li>
                    <strong>Make the call</strong>
                    <p>Compare answers side by side and choose a date.</p>
                  </li>
                </ol>
              </div>
              <MyTrips />
            </aside>
          </div>
        </>
      ) : (
        <>
          <TripHeading
            title={draft.name}
            detail={`${draft.duration}-day options · ${draft.timeZone.replaceAll("_", " ")}`}
          >
            <button
              className="button secondary"
              type="button"
              onClick={() => change({ exploring: false })}
            >
              Edit trip
            </button>
          </TripHeading>
          <div className="planner-progress" aria-label="Planning progress">
            <span aria-current="step">
              <b>1</b> Find dates
            </span>
            <span>
              <b>2</b> Ask your people
            </span>
            <span>
              <b>3</b> Choose together
            </span>
          </div>
          <CalendarConnection
            calendar={calendar}
            onConnect={() => void connect()}
            onReconnect={() => void connect(true)}
          />
          {notice && (
            <p className="notice" role="status" style={{ marginBottom: 20 }}>
              {notice}
            </p>
          )}
          <div className="explorer-layout">
            <DateExplorer
              windows={windows}
              selected={draft.selectedDates}
              focused={selected?.start || ""}
              onFocus={inspect}
              onToggle={toggle}
            />
            <div className="explorer-sidebar">
              <section
                className={`shortlist-panel panel${shortlistOpen ? " expanded" : ""}`}
                aria-labelledby="shortlist-title"
              >
                <div className="section-heading">
                  <h2 id="shortlist-title">Your shortlist</h2>
                  <div className="shortlist-heading-actions">
                    <span className="badge">{draft.selectedDates.length}</span>
                    <button
                      type="button"
                      className="text-button mobile-only"
                      aria-expanded={shortlistOpen}
                      onClick={() => setShortlistOpen((value) => !value)}
                    >
                      {shortlistOpen ? "Close" : "Review"}
                    </button>
                  </div>
                </div>
                <div className="shortlist-content">
                  <p className="muted small">
                    {draft.selectedDates.length > 5
                      ? "Lots to choose from. Consider narrowing this to 3 to 5 dates before sharing."
                      : "Aim for 3 to 5 options for your people to compare."}
                  </p>
                  {draft.selectedDates.length ? (
                    <ul className="shortlisted-dates">
                      {draft.selectedDates.map((date) => (
                        <li key={date}>
                          <button
                            type="button"
                            className="shortlist-date"
                            onClick={() => inspect(date)}
                          >
                            {dateRangeLabel(date, draft.duration)}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove shortlisted ${dateRangeLabel(date, draft.duration)}`}
                            onClick={() => toggle(date)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-shortlist">
                      <span aria-hidden="true">＋</span>
                      <p>
                        Add an option with the + button, or start with a few
                        suggestions.
                      </p>
                    </div>
                  )}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      const chosen = windows.filter((window) =>
                        draft.selectedDates.includes(window.start),
                      );
                      const suggestions = suggestDiverseWindows(
                        windows.filter((window) =>
                          chosen.every(
                            (other) =>
                              window.end < other.start ||
                              window.start > other.end,
                          ),
                        ),
                      );
                      change({
                        selectedDates: [
                          ...draft.selectedDates,
                          ...suggestions.map((window) => window.start),
                        ]
                          .slice(0, 100)
                          .sort(),
                      });
                      setNotice(
                        suggestions.length
                          ? `Added ${suggestions.length} separate ${suggestions.length === 1 ? "option" : "options"}. ${calendar.result ? "Review the details before sharing." : "Your calendar has not been checked."}`
                          : "No more non-overlapping options fit this range. You can still add dates individually.",
                      );
                    }}
                  >
                    Suggest {draft.selectedDates.length ? "more" : "3"} separate
                    options
                  </button>
                  {calendar.result && (
                    <label className="rest-preference">
                      <input
                        type="checkbox"
                        checked={draft.restDay}
                        onChange={(event) =>
                          change({ restDay: event.target.checked })
                        }
                      />
                      <span>Prefer a clear day around nearby travel</span>
                    </label>
                  )}
                  <button
                    className="button create-invitation"
                    type="button"
                    disabled={!draft.selectedDates.length || saving}
                    onClick={() => void createInvitation()}
                  >
                    {saving
                      ? "Creating invitation…"
                      : status === "authenticated"
                        ? "Create invitation"
                        : "Sign in to create invitation"}
                  </button>
                  <p className="muted small">
                    You’ll get a link to share. No invitations are emailed
                    automatically.
                  </p>
                  {error && (
                    <p className="notice error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </section>
              {selected && (
                <OptionDetails
                  window={selected}
                  selected={draft.selectedDates.includes(selected.start)}
                  timeZone={draft.timeZone}
                  onToggle={() => toggle(selected.start)}
                  onOverride={(key, value) =>
                    setOverrides((current) => ({ ...current, [key]: value }))
                  }
                />
              )}
            </div>
          </div>
          {calendar.calendarIds.length > 0 && (
            <HistoryPanel
              key={JSON.stringify([
                session?.user?.email,
                draft.startDate,
                draft.endDate,
                draft.timeZone,
                [...calendar.calendarIds].sort(),
              ])}
              range={draft}
              calendars={calendar.calendars}
              calendarIds={calendar.calendarIds}
            />
          )}
          {draft.selectedDates.length > 0 && (
            <div className="mobile-shortlist-bar">
              <strong>
                {draft.selectedDates.length}{" "}
                {draft.selectedDates.length === 1 ? "date" : "dates"}{" "}
                shortlisted
              </strong>
              <button
                type="button"
                className="button secondary"
                onClick={reviewShortlist}
              >
                Review shortlist
              </button>
            </div>
          )}
        </>
      )}
    </TripShell>
  );
}
