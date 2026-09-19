"use client";

import type { ScanCoverage } from "@/lib/calendar/types";

interface CalendarCoverageProps {
  coverage: ScanCoverage | null | undefined;
  eventCount: number;
  historicalCoverages?: ScanCoverage[];
  onRetry?: () => void;
}

function failedNames(coverage: ScanCoverage): string {
  return coverage.failedCalendars
    .map((failure) => failure.name || failure.calendarId)
    .join(", ");
}

export default function CalendarCoverage({
  coverage,
  eventCount,
  historicalCoverages = [],
  onRetry,
}: CalendarCoverageProps) {
  if (!coverage) return null;
  const historyIncomplete = historicalCoverages.some(
    (item) => item.status !== "complete" || item.truncated
  );

  return (
    <div style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
      {coverage.status === "failed" && (
        <div role="alert" style={{ padding: "11px 13px", borderRadius: "12px", background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", fontSize: "12px", lineHeight: 1.45 }}>
          <div style={{ fontWeight: 700 }}>Calendar scan failed</div>
          {coverage.failedCalendars.length > 0 && (
            <div>Could not load: {failedNames(coverage)}</div>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} style={{ marginTop: "7px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #B91C1C", background: "#fff", color: "#991B1B", fontWeight: 700, cursor: "pointer" }}>
              Retry scan
            </button>
          )}
        </div>
      )}

      {coverage.status === "partial" && (
        <div role="status" style={{ padding: "11px 13px", borderRadius: "12px", background: "#FFF7ED", border: "1px solid #FED7AA", color: "#9A3412", fontSize: "12px", lineHeight: 1.45 }}>
          <div style={{ fontWeight: 700 }}>Best among loaded calendars</div>
          <div>Could not load: {failedNames(coverage)}</div>
        </div>
      )}

      {coverage.truncated && (
        <div role="status" style={{ padding: "11px 13px", borderRadius: "12px", background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", fontSize: "12px", lineHeight: 1.45 }}>
          <strong>Calendar results were limited.</strong> Recommendations use only the events returned before the provider limit.
        </div>
      )}

      {coverage.status === "complete" && !coverage.truncated && eventCount === 0 && (
        <div role="status" style={{ padding: "9px 12px", borderRadius: "10px", background: "#F0FFF4", border: "1px solid #BBF7D0", color: "#166534", fontSize: "12px", fontWeight: 700 }}>
          All clear across loaded calendars
        </div>
      )}

      {historyIncomplete && (
        <div role="status" style={{ padding: "9px 12px", borderRadius: "10px", background: "#F5F3FF", border: "1px solid #DDD6FE", color: "#5B21B6", fontSize: "12px" }}>
          Historical calendar data is incomplete
        </div>
      )}
    </div>
  );
}
