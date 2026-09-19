"use client";

import { useState } from "react";
import {
  findCandidateStart,
  formatLocalDate,
  groupEventsByCluster,
  indexEventsByDate,
} from "@/lib/analysis";

const C = {
  card: "#FFFFFF",
  primary: "#1B4332",
  primaryLight: "#2D6A4F",
  primaryPale: "#E8F5EE",
  accent: "#E8A838",
  accentLight: "#FFF3DC",
  text: "#2D2D2D",
  textMuted: "#6B7280",
  border: "#E5E1DB",
  danger: "#C0392B",
  warning: "#E67E22",
  success: "#27AE60",
  successBg: "#F0FFF4",
};

export function CalendarView({
  startDate,
  endDate,
  events,
  duration,
  preset,
  selectedDates,
  onToggleDate,
  recommendedWindows,
}) {
  const conflictMap = {};
  for (const [date, dateEvents] of Object.entries(indexEventsByDate(events))) {
    const blockingEvents = dateEvents.filter((event) => event.countsAsConflict !== false);
    conflictMap[date] = {
      score: blockingEvents.reduce(
        (total, event) => total + (event.importance_score || 0),
        0
      ),
      count: blockingEvents.length,
      fixed: blockingEvents.filter((event) => event.moveable === false).length,
      events: dateEvents,
    };
  }

  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const getWindowForDate = (date) => {
    if (!recommendedWindows) return null;
    return recommendedWindows.find((window) => date >= window.start && date <= window.end);
  };
  const getColor = (date) => {
    const conflict = conflictMap[date];
    if (!conflict || conflict.count === 0) {
      return { bg: C.successBg, text: C.success, label: "Clear" };
    }
    if (conflict.fixed > 0 || conflict.score >= 12) {
      return { bg: "#FEE2E2", text: C.danger, label: "High" };
    }
    if (conflict.score >= 5) {
      return { bg: "#FFF3DC", text: "#B8860B", label: "Medium" };
    }
    return { bg: "#E8F5EE", text: C.success, label: "Low" };
  };
  const isInRange = (date) => date >= startDate && date <= endDate;
  const isInSelectedWindow = (date) => {
    if (!selectedDates || !duration) return false;
    return selectedDates.some((selectedDate) => {
      const selectedEnd = new Date(selectedDate + "T12:00:00");
      selectedEnd.setDate(selectedEnd.getDate() + duration - 1);
      return date >= selectedDate && date <= formatLocalDate(selectedEnd);
    });
  };

  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const [tooltip, setTooltip] = useState(null);

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        {[
          { color: C.successBg, border: C.success, label: "Clear" },
          { color: "#FFF3DC", border: "#D4A017", label: "Some conflicts" },
          { color: "#FEE2E2", border: C.danger, label: "Major conflicts" },
        ].map((legend) => (
          <div key={legend.label} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
            <div style={{ width: 14, height: 14, borderRadius: "4px", background: legend.color, border: "1.5px solid " + legend.border }} />
            {legend.label}
          </div>
        ))}
      </div>

      {months.map(({ year, month }) => {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const cells = [];
        for (let index = 0; index < firstDay; index += 1) cells.push(null);
        for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);

        return (
          <div key={year + "-" + month} style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: C.text, textAlign: "center", marginBottom: "10px" }}>
              {new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "3px" }}>
              {days.map((day) => <div key={day} style={{ textAlign: "center", fontSize: "10px", fontWeight: 600, color: C.textMuted, padding: "4px 0", textTransform: "uppercase" }}>{day}</div>)}
              {cells.map((day, index) => {
                if (day === null) return <div key={"e" + index} />;
                const date =
                  year +
                  "-" +
                  String(month + 1).padStart(2, "0") +
                  "-" +
                  String(day).padStart(2, "0");
                const inRange = isInRange(date);
                const conflict = conflictMap[date];
                const color = inRange ? getColor(date) : { bg: "#F3F4F6", text: "#D1D5DB" };
                const window = getWindowForDate(date);
                const candidateStart = findCandidateStart(date, recommendedWindows, preset);
                const selectedWindow = isInSelectedWindow(date);
                const isStart = selectedDates?.includes(date);
                const isToday = date === formatLocalDate(new Date());

                return (
                  <div
                    key={date}
                    onClick={() => {
                      if (inRange && candidateStart && onToggleDate) onToggleDate(candidateStart);
                    }}
                    onMouseEnter={() => {
                      if (inRange && conflict) setTooltip({ dateStr: date, conflict });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      position: "relative",
                      aspectRatio: "1",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: inRange ? 600 : 400,
                      background: selectedWindow ? C.primaryPale : inRange ? color.bg : "#F9F9F9",
                      color: selectedWindow ? C.primary : inRange ? color.text : "#D1D5DB",
                      border: isStart
                        ? "2px solid " + C.primary
                        : selectedWindow
                          ? "1.5px solid " + C.primaryLight
                          : window
                            ? "1.5px dashed " + C.primaryLight
                            : "1px solid transparent",
                      cursor: inRange && candidateStart ? "pointer" : "default",
                      transition: "all 0.15s",
                      opacity: inRange ? 1 : 0.4,
                    }}
                  >
                    {day}
                    {inRange && conflict && conflict.count > 0 && (
                      <div style={{ display: "flex", gap: "1px", marginTop: "1px" }}>
                        {Array.from({ length: Math.min(conflict.count, 3) }).map((_, dot) => (
                          <div key={dot} style={{ width: 4, height: 4, borderRadius: "50%", background: color.text }} />
                        ))}
                      </div>
                    )}
                    {isToday && <div style={{ position: "absolute", bottom: 2, width: 4, height: 4, borderRadius: "50%", background: C.accent }} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {tooltip && (
        <div style={{ background: C.card, borderRadius: "12px", padding: "12px 14px", border: "1px solid " + C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", marginTop: "-8px", marginBottom: "8px" }}>
          <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
            {new Date(tooltip.dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          </div>
          {tooltip.conflict.events.map((event, index) => (
            <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", fontSize: "12px", color: C.textMuted }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: event.importance_score >= 7 ? C.danger : event.importance_score >= 4 ? C.warning : C.success, flexShrink: 0 }} />
              {event.title}
              <span style={{ marginLeft: "auto", fontWeight: 600, fontSize: "11px" }}>{event.importance_score}/10</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniMonth({ year, month, startDate, endDate, conflictMap }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const dateString = (day) => year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  const isInWindow = (day) => dateString(day) >= startDate && dateString(day) <= endDate;
  const conflictLevel = (day) => {
    const conflict = conflictMap?.[dateString(day)];
    if (!conflict) return 0;
    if (conflict.high > 0) return 2;
    if (conflict.total > 0) return 1;
    return 0;
  };
  const cells = [];
  for (let index = 0; index < firstDay; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);

  return (
    <div style={{ width: "72px", flexShrink: 0 }}>
      <div style={{ fontSize: "8px", fontWeight: 700, color: C.textMuted, textAlign: "center", marginBottom: "3px", textTransform: "uppercase" }}>
        {new Date(year, month).toLocaleDateString("en-US", { month: "short" })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" }}>
        {days.map((day, index) => <div key={day + index} style={{ fontSize: "5px", textAlign: "center", color: C.textMuted, fontWeight: 600, lineHeight: "8px" }}>{day}</div>)}
        {cells.map((day, index) => {
          if (day === null) return <div key={"e" + index} style={{ width: "9px", height: "9px" }} />;
          const inWindow = isInWindow(day);
          const level = inWindow ? conflictLevel(day) : -1;
          return (
            <div key={day} style={{ width: "9px", height: "9px", borderRadius: "2px", fontSize: "5px", display: "flex", alignItems: "center", justifyContent: "center", background: inWindow ? (level === 2 ? "#FEE2E2" : level === 1 ? "#FFF3DC" : C.successBg) : "transparent", color: inWindow ? (level === 2 ? C.danger : level === 1 ? "#B8860B" : C.success) : "#D1D5DB", fontWeight: inWindow ? 700 : 400, border: inWindow ? "1px solid " + (level === 2 ? C.danger : level === 1 ? "#D4A017" : C.success) : "none" }}>
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({ startDate, endDate, conflictMap }) {
  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end && months.length < 2) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return (
    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
      {months.map((month) => (
        <MiniMonth
          key={month.year + "-" + month.month}
          year={month.year}
          month={month.month}
          startDate={startDate}
          endDate={endDate}
          conflictMap={conflictMap}
        />
      ))}
    </div>
  );
}

const TRAVEL_TONE = {
  overlapping: { color: C.danger, background: "#FEE2E2", border: "#FECACA" },
  severe: { color: C.danger, background: "#FEE2E2", border: "#FECACA" },
  high: { color: "#92400E", background: "#FFF7ED", border: "#FED7AA" },
  moderate: { color: "#92400E", background: "#FFF7ED", border: "#FED7AA" },
  low: { color: C.textMuted, background: "#F8FAFC", border: C.border },
};

// chainJourneys labels a single flight leg "Travel day" precisely because one leg cannot say
// whether the traveller was departing or coming home. Only a high-confidence flight chain
// (multiple legs) carries enough evidence to claim a direction; everything else must describe
// adjacency without asserting which way the traveller was going. Accepts "flight-pair" too —
// a concurrent rename to "flight-chain" is in flight in src/lib/calendar/away.ts.
function hasDirectionalEvidence(adjacency) {
  const source = adjacency.span?.source;
  const isChain = source === "flight-chain" || source === "flight-pair";
  return isChain && adjacency.span?.confidence === "high";
}

// A single-day, low-confidence span (an unpaired flight leg) only earns a chip when it
// actually touches the window — otherwise real trips get drowned out by "you flew somewhere
// four days ago" noise.
function worthShowing(adjacency) {
  if (adjacency.severity === "overlapping" || adjacency.severity === "severe") return true;
  const span = adjacency.span;
  if (!span) return true;
  const singleDay = span.startDate === span.endDate;
  return !(singleDay && span.confidence === "low");
}

function travelAdjacencyText(adjacency) {
  const label = adjacency.span?.label || "Away";
  if (adjacency.direction === "overlapping") {
    return label + " overlaps this weekend";
  }
  if (adjacency.gapDays === 0) {
    if (!hasDirectionalEvidence(adjacency)) {
      return adjacency.direction === "before"
        ? label + ", the day before this starts"
        : label + ", the day after this ends";
    }
    return adjacency.direction === "before"
      ? label + ", home the day before this starts"
      : label + ", leaving the day after this ends";
  }
  const unit = adjacency.gapDays === 1 ? "day" : "days";
  const side = adjacency.direction === "before" ? "before" : "after";
  return label + ", " + adjacency.gapDays + " " + unit + " " + side;
}

export function WindowCard({
  window: windowData,
  selected,
  onToggle,
  rank,
  preset,
  conflictMap,
  groupVotes,
  isInvitee,
  connectedCalendars,
  preference,
  histClusters,
}) {
  const [expanded, setExpanded] = useState(true);
  const [openClusters, setOpenClusters] = useState({});
  const hasCurrentEvents = windowData.windowEvents && windowData.windowEvents.length > 0;
  const history = windowData.historicalInsight || {
    byYear: {},
    years: [],
    totalMatches: 0,
    seasonalInsights: [],
  };
  const hasHistorical = history.years && history.years.length > 0;
  const [historyExpanded, setHistoryExpanded] = useState(!hasCurrentEvents && hasHistorical);
  const start = new Date(windowData.start + "T12:00:00");
  const end = new Date(windowData.end + "T12:00:00");

  let dateLabel;
  let dateSubLabel;
  if (preset === "day") {
    dateLabel = start.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    dateSubLabel = null;
  } else if (preset === "weekend") {
    dateLabel = "Weekend of " + start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    dateSubLabel = "Fri – Sun";
  } else if (preset === "week") {
    dateLabel = "Week of " + start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    dateSubLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " – " + end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else {
    dateLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " – " + end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    dateSubLabel = null;
  }

  const severityMap = {
    unknown: { icon: "○", label: "Not fully checked", text: C.textMuted, bg: C.bg },
    high: { text: C.danger, label: "Heavy conflicts", icon: "🔴" },
    moderate: { text: "#92400E", label: "Some conflicts", icon: "🟡" },
    low: { text: C.success, label: "Minor", icon: "🟢" },
    clear: { text: C.success, label: "All clear", icon: "🟢" },
  };
  const severity = severityMap[windowData.aiSeverity] || severityMap.unknown;
  const vote = groupVotes?.[windowData.start];
  const groupPercent = vote ? Math.round((vote.yes.length / vote.total) * 100) : null;
  const groupPopular = groupPercent !== null && groupPercent >= 60;
  const calendarColors = connectedCalendars
    ? Object.fromEntries(connectedCalendars.map((calendar) => [calendar.name, calendar.color]))
    : { Work: "#4285F4", Personal: "#8E44AD", Family: "#E67E22", Social: "#27AE60" };

  const eventRow = (event, key, last = false) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", borderBottom: last ? "none" : "1px solid " + C.border }}>
      <div style={{ width: 3, height: 20, borderRadius: "2px", background: calendarColors[event.calendar] || C.textMuted, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
          {event.title}
          {!event.moveable && event.importance_score && <span style={{ fontSize: "8px", padding: "1px 4px", borderRadius: "3px", background: "#FEE2E2", color: C.danger, fontWeight: 700 }}>FIXED</span>}
          {event.recurring && <span style={{ fontSize: "9px", color: C.textMuted }}>🔄</span>}
        </div>
        <div style={{ fontSize: "10px", color: C.textMuted, display: "flex", alignItems: "center", gap: "3px", flexWrap: "wrap" }}>
          {new Date(event.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(event.importance_score ? {} : { year: "numeric" }) })}
          {event.time && <span>· {event.time}</span>}
          {event.duration && <span>· {event.duration}</span>}
          {event.calendar && <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>· <span style={{ width: 6, height: 6, borderRadius: "50%", background: calendarColors[event.calendar] || C.textMuted, display: "inline-block" }} /> {event.calendar}</span>}
        </div>
        {event.location && <div style={{ fontSize: "10px", color: C.textMuted, marginTop: "1px" }}>📍 {event.location}</div>}
        {event.attendees > 0 && <div style={{ fontSize: "10px", color: C.textMuted }}>👥 {event.attendees} attendee{event.attendees > 1 ? "s" : ""}</div>}
        {event.description && <div style={{ fontSize: "10px", color: C.textMuted, fontStyle: "italic", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.description.slice(0, 60)}{event.description.length > 60 ? "..." : ""}</div>}
      </div>
      {event.importance_score && <div style={{ fontSize: "11px", fontWeight: 700, color: event.importance_score >= 7 ? C.danger : event.importance_score >= 4 ? "#B8860B" : C.success, flexShrink: 0 }}>{event.importance_score}/10</div>}
    </div>
  );

  const formatClusterRange = (group) => {
    const groupStart = new Date(group.startDate + "T12:00:00");
    const groupEnd = new Date(group.endDate + "T12:00:00");
    const startText = groupStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (group.startDate === group.endDate) return startText + ", " + groupStart.getFullYear();
    const endText = groupEnd.toLocaleDateString(
      "en-US",
      groupStart.getMonth() === groupEnd.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" }
    );
    return startText + "–" + endText + ", " + groupEnd.getFullYear();
  };

  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        onClick={(event) => {
          if (event.target.closest("[data-expand]")) return;
          if (!selected) setExpanded(false);
          onToggle();
        }}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", border: selected ? "2px solid " + C.primary : groupPopular ? "2px solid #4285F4" : "1px solid " + C.border, background: selected ? C.primaryPale : C.card, padding: "14px", borderRadius: expanded ? "16px 16px 0 0" : "16px", fontFamily: "inherit", display: "flex", gap: "12px", alignItems: "flex-start", transition: "all 0.15s", boxShadow: selected ? "0 2px 12px rgba(27,67,50,0.1)" : "0 1px 4px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}
      >
        {rank === 0 && windowData.aiSeverity === "clear" && windowData.coverage?.status === "complete" && !windowData.coverage?.truncated && !groupPopular && <div style={{ position: "absolute", top: 0, right: 0, background: C.success, color: "#fff", fontSize: "9px", fontWeight: 700, padding: "3px 10px", borderBottomLeftRadius: "10px", textTransform: "uppercase" }}>Best for you</div>}
        {groupPopular && <div style={{ position: "absolute", top: 0, right: 0, background: "#4285F4", color: "#fff", fontSize: "9px", fontWeight: 700, padding: "3px 10px", borderBottomLeftRadius: "10px", textTransform: "uppercase" }}>{vote.yes.length}/{vote.total} want this</div>}
        <MiniCalendar startDate={windowData.start} endDate={windowData.end} conflictMap={conflictMap} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "15px", color: selected ? C.primary : C.text, marginBottom: "2px" }}>{dateLabel}</div>
          {dateSubLabel && <div style={{ fontSize: "11px", color: C.textMuted, marginBottom: "4px" }}>{dateSubLabel}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px" }}>{severity.icon}</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: severity.text }}>{severity.label}</span>
            {windowData.eventCount > 0 && <span style={{ fontSize: "11px", color: C.textMuted }}>· {windowData.eventCount} event{windowData.eventCount > 1 ? "s" : ""}</span>}
            {windowData.aiSeverity === "high" && <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "#FEE2E2", color: C.danger, fontWeight: 600 }}>Flagged</span>}
          </div>
          <div style={{ fontSize: "12px", color: C.textMuted, lineHeight: 1.4 }}>{windowData.summary}</div>
          {windowData.travelAdjacency && worthShowing(windowData.travelAdjacency) && (() => {
            // Low confidence renders muted regardless of severity, so one glance separates
            // "we know" (a high-confidence flight chain) from "we're guessing" (everything else).
            const tone = windowData.travelAdjacency.span?.confidence === "low"
              ? TRAVEL_TONE.low
              : (TRAVEL_TONE[windowData.travelAdjacency.severity] || TRAVEL_TONE.low);
            return (
              <div
                data-testid="travel-adjacency"
                style={{
                  marginTop: "6px",
                  padding: "5px 8px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  lineHeight: 1.4,
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  color: tone.color,
                  background: tone.background,
                  border: "1px solid " + tone.border,
                }}
              >
                <span>✈️</span>
                <span>{travelAdjacencyText(windowData.travelAdjacency)}</span>
              </div>
            );
          })()}
          {vote && isInvitee && (
            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ flex: 1, height: "4px", borderRadius: "2px", background: C.border, overflow: "hidden" }}>
                <div style={{ width: groupPercent + "%", height: "100%", background: groupPopular ? "#4285F4" : C.textMuted, borderRadius: "2px" }} />
              </div>
              <span style={{ fontSize: "10px", color: C.textMuted }}>{groupPercent}%</span>
            </div>
          )}
          <button data-expand="1" onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: C.primary, fontWeight: 600, fontFamily: "inherit", padding: "4px 0 0", display: "flex", alignItems: "center", gap: "3px" }}>
            {expanded ? "▾ Less" : "▸ Details"}
          </button>
        </div>
        <div style={{ width: 26, height: 26, borderRadius: "50%", border: preference === "preferred" ? "2px solid " + C.accent : selected ? "none" : "2px solid " + C.border, background: preference === "preferred" ? C.accentLight : selected ? C.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: preference === "preferred" ? "#B8860B" : "#fff", fontSize: "13px", flexShrink: 0, marginTop: "4px" }}>
          {preference === "preferred" ? "⭐" : selected ? "✓" : ""}
        </div>
      </div>

      {expanded && (
        <div style={{ border: selected ? "2px solid " + C.primary : "1px solid " + C.border, borderTop: "none", borderRadius: "0 0 16px 16px", background: selected ? "#F4FBF7" : "#FAFAFA", padding: "12px 14px", animation: "fadeUp 0.15s ease" }}>
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", padding: "8px 12px", borderRadius: "10px", background: C.primaryPale }}>
              <span style={{ fontSize: "14px" }}>📋</span>
              <span style={{ fontSize: "13px", fontWeight: 700, color: C.primary }}>Your Scheduled Events</span>
              {hasCurrentEvents && <span style={{ fontSize: "11px", fontWeight: 600, color: C.primary, background: "#fff", padding: "2px 8px", borderRadius: "10px", marginLeft: "auto" }}>{windowData.windowEvents.length} event{windowData.windowEvents.length > 1 ? "s" : ""}</span>}
            </div>
            {hasCurrentEvents
              ? windowData.windowEvents.map((event, index) => eventRow(event, index, index === windowData.windowEvents.length - 1))
              : <div style={{ fontSize: "12px", color: C.success, padding: "6px 0", display: "flex", alignItems: "center", gap: "6px" }}>{windowData.summary}</div>}
          </div>

          <div style={{ height: 1, background: C.border, margin: "4px 0 10px" }} />
          <div style={{ marginBottom: "8px" }}>
            <button onClick={() => setHistoryExpanded(!historyExpanded)} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, display: "flex", alignItems: "center", gap: "8px", marginBottom: historyExpanded ? "8px" : "0" }}>
              <span style={{ fontSize: "13px" }}>📅</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: C.textMuted }}>Past Year Events</span>
              {history.totalMatches > 0 && <span style={{ fontSize: "10px", fontWeight: 600, color: C.textMuted, background: "#F3F4F6", padding: "2px 7px", borderRadius: "8px" }}>{history.totalMatches} match{history.totalMatches > 1 ? "es" : ""}</span>}
              <span style={{ marginLeft: "auto", fontSize: "11px", color: C.textMuted, fontWeight: 600 }}>{historyExpanded ? "▾" : "▸"}</span>
            </button>
            {historyExpanded && (
              <div style={{ opacity: 0.85 }}>
                {hasHistorical ? history.years.map((year) => {
                  const { clusters, singles } = groupEventsByCluster(history.byYear[year], histClusters);
                  return (
                    <div key={year} style={{ marginBottom: "8px", background: "#F9F8F6", borderRadius: "10px", padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: C.text }}>{year}</span>
                        <span style={{ fontSize: "10px", color: C.textMuted }}>({history.byYear[year].length} event{history.byYear[year].length > 1 ? "s" : ""})</span>
                      </div>
                      {clusters.map((group) => {
                        const key = year + "-" + group.clusterId;
                        const open = Boolean(openClusters[key]);
                        return (
                          <div key={key} style={{ borderBottom: "1px solid " + C.border }}>
                            <button onClick={() => setOpenClusters((current) => ({ ...current, [key]: !open }))} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "5px 0", display: "flex", alignItems: "center", gap: "8px", textAlign: "left" }}>
                              <span style={{ fontSize: "13px", flexShrink: 0 }}>{group.emoji}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: "12px", fontWeight: 700, color: C.text }}>{group.label}</div>
                                <div style={{ fontSize: "10px", color: C.textMuted }}>{formatClusterRange(group)} · {group.events.length}{group.events.length < group.eventCount ? " of " + group.eventCount : ""} event{group.eventCount > 1 ? "s" : ""}</div>
                              </div>
                              <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "6px", background: "#F0F4FF", color: "#4338CA", fontWeight: 600, flexShrink: 0 }}>✨ AI</span>
                              <span style={{ fontSize: "10px", color: C.textMuted, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
                            </button>
                            {open && <div style={{ paddingLeft: "10px", marginBottom: "4px" }}>{group.events.map((event, index) => eventRow(event, "c" + index, index === group.events.length - 1))}</div>}
                          </div>
                        );
                      })}
                      {singles.map((event, index) => eventRow(event, index, index === singles.length - 1))}
                    </div>
                  );
                }) : <div style={{ fontSize: "11px", color: C.textMuted, padding: "4px 0" }}>No past events found for these dates.</div>}
                {history.seasonalInsights && history.seasonalInsights.length > 0 && history.seasonalInsights[0].text !== "No historical data available for this period." && history.seasonalInsights[0].text !== "No events found in past years for these dates — historically clear." && (
                  <div style={{ marginTop: "4px" }}>
                    {history.seasonalInsights.map((insight, index) => (
                      <div key={index} style={{ display: "flex", gap: "5px", alignItems: "center", padding: "3px 0", fontSize: "10px", color: C.textMuted, lineHeight: 1.3 }}>
                        <span style={{ flexShrink: 0 }}>{insight.icon}</span>
                        <span>{insight.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {vote && isInvitee && (
            <>
              <div style={{ height: 1, background: C.border, margin: "4px 0 10px" }} />
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px" }}>👥 Group Preference</div>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {vote.yes.map((name, index) => <span key={index} style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "6px", background: "#EBF5FF", color: "#1D4ED8", fontWeight: 600 }}>✓ {name}</span>)}
                  {vote.no.map((name, index) => <span key={"n" + index} style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "6px", background: "#F3F4F6", color: "#9CA3AF", fontWeight: 500 }}>— {name}</span>)}
                </div>
                {groupPopular && <div style={{ marginTop: "6px", fontSize: "11px", color: "#1D4ED8", fontWeight: 600 }}>⭐ Popular with your group — selecting this helps everyone align</div>}
                {vote.yes.length <= 1 && <div style={{ marginTop: "6px", fontSize: "11px", color: C.textMuted }}>Few others selected this — may be harder to coordinate</div>}
              </div>
            </>
          )}

          {windowData.aiSeverity === "high" && <div style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "8px", background: "#FFF7ED", border: "1px solid #FED7AA", fontSize: "11px", color: "#92400E", lineHeight: 1.4 }}>⚠️ Heavy conflicts detected, but you can still select this. {groupPopular ? "Since it's popular with your group, it may be worth it if you can reschedule." : "If these events are negotiable, it could still work."}</div>}
        </div>
      )}
    </div>
  );
}
