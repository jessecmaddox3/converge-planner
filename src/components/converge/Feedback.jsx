"use client";

import { useEffect, useState } from "react";
import { LOG_LEVEL_COLORS, logger } from "@/lib/client-logger";

const C = {
  card: "#FFFFFF",
  primary: "#1B4332",
  primaryPale: "#E8F5EE",
  accentLight: "#FFF3DC",
  text: "#2D2D2D",
  textMuted: "#6B7280",
  border: "#E5E1DB",
  danger: "#C0392B",
  dangerBg: "#FEF2F2",
  warningBg: "#FFF8F0",
  success: "#27AE60",
  successBg: "#F0FFF4",
};

export function Badge({ children, variant = "default" }) {
  const styles = {
    default: { background: C.primaryPale, color: C.primary },
    danger: { background: C.dangerBg, color: C.danger },
    warning: { background: C.warningBg, color: "#E67E22" },
    success: { background: C.successBg, color: C.success },
    accent: { background: C.accentLight, color: "#B8860B" },
  };
  return (
    <span style={{ ...styles[variant], padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function ProgressBar({ value, max = 100, color = C.primary }) {
  return (
    <div style={{ width: "100%", height: "6px", background: C.border, borderRadius: "3px", overflow: "hidden" }}>
      <div style={{ width: (value / max) * 100 + "%", height: "100%", background: color, borderRadius: "3px", transition: "width 0.6s ease" }} />
    </div>
  );
}

export function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
      <div style={{ width: 32, height: 32, border: "3px solid " + C.border, borderTopColor: C.primary, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );
}

export function ErrorDisplay({ error, context, onRetry, onBack, onDismiss }) {
  const [logsCopied, setLogsCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const errObj = typeof error === "object"
    ? { message: error?.message || String(error), stack: error?.stack, name: error?.name }
    : { message: String(error) };
  const recentErrors = logger.getLogs()
    .filter((entry) => entry.level === "ERROR" || entry.level === "FATAL")
    .slice(-8);

  const fallbackCopy = (text) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 3000);
  };

  const copyLogs = () => {
    const extra =
      "\n\n═══ ERROR CONTEXT ═══\nError: " +
      errObj.message +
      "\nContext: " +
      (context || "unknown") +
      "\n" +
      (errObj.stack || "");
    const full = logger.exportAsText() + extra;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(full)
        .then(() => {
          setLogsCopied(true);
          logger.info("ErrorDisplay", "Logs copied to clipboard");
          setTimeout(() => setLogsCopied(false), 3000);
        })
        .catch(() => fallbackCopy(full));
    } else {
      fallbackCopy(full);
    }
  };

  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ background: C.dangerBg, border: "1px solid #FECACA", borderRadius: "16px", padding: "24px", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div style={{ width: 44, height: 44, borderRadius: "12px", background: "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>⚠️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "16px", color: C.danger }}>Something went wrong</div>
            <div style={{ fontSize: "13px", color: C.textMuted, marginTop: "2px" }}>{context || "An unexpected error occurred"}</div>
          </div>
        </div>
        <div style={{ background: "#fff", borderRadius: "10px", padding: "12px 14px", border: "1px solid #FECACA", fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: "13px", color: C.danger, lineHeight: 1.5, wordBreak: "break-word", marginBottom: "16px" }}>
          {errObj.message}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={copyLogs} style={{ flex: 1, minWidth: "120px", padding: "12px 16px", borderRadius: "10px", border: "1.5px solid " + C.danger, background: logsCopied ? C.danger : "transparent", color: logsCopied ? "#fff" : C.danger, fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            {logsCopied ? "✓ Copied Full Logs!" : "📋 Copy Full Logs"}
          </button>
          {onRetry && <button onClick={onRetry} style={{ flex: 1, minWidth: "100px", padding: "12px 16px", borderRadius: "10px", border: "none", background: C.primary, color: "#fff", fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>↻ Retry</button>}
        </div>
      </div>

      <button onClick={() => setShowDetails(!showDetails)} style={{ width: "100%", padding: "12px 16px", borderRadius: "12px", border: "1px solid " + C.border, background: C.card, cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 600, color: C.textMuted, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Technical Details ({recentErrors.length} recent errors)</span>
        <span style={{ transform: showDetails ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▼</span>
      </button>

      {showDetails && (
        <div style={{ marginTop: "8px", background: "#1E1E2E", borderRadius: "12px", padding: "16px", maxHeight: "300px", overflow: "auto" }}>
          {errObj.stack && (
            <>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#F87171", textTransform: "uppercase", marginBottom: "6px" }}>Stack Trace</div>
              <pre style={{ fontSize: "11px", color: "#A1A1AA", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "0 0 16px 0" }}>{errObj.stack}</pre>
            </>
          )}
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#60A5FA", textTransform: "uppercase", marginBottom: "6px" }}>Recent Log Entries</div>
          {recentErrors.map((entry, index) => (
            <div key={index} style={{ fontSize: "11px", color: "#A1A1AA", padding: "4px 0", borderBottom: "1px solid #2E2E3E", lineHeight: 1.5 }}>
              <span style={{ color: LOG_LEVEL_COLORS[entry.level] }}>[{entry.level}]</span>{" "}
              <span style={{ color: "#6EE7B7" }}>[{entry.category}]</span>{" "}
              {entry.message}
            </div>
          ))}
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#6B7280" }}>Session: {logger.getSessionInfo().sessionId} · {logger.getLogs().length} total entries</div>
        </div>
      )}

      <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
        {onBack && <button onClick={onBack} style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "1.5px solid " + C.border, background: "transparent", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: "inherit", color: C.text }}>← Go Back</button>}
        {onDismiss && <button onClick={onDismiss} style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "1.5px solid " + C.border, background: "transparent", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: "inherit", color: C.textMuted }}>Dismiss</button>}
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }) {
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9980, display: "flex", flexDirection: "column", gap: "8px", maxWidth: "420px", width: "90%" }}>
      {toasts.map((toast) => (
        <div key={toast.id} onClick={() => onDismiss(toast.id)} style={{ padding: "12px 16px", borderRadius: "12px", background: toast.type === "error" ? "#7F1D1D" : toast.type === "warning" ? "#78350F" : toast.type === "success" ? "#14532D" : "#1E1E2E", color: "#fff", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "fadeUp 0.3s ease", cursor: "pointer" }}>
          <span>{toast.type === "error" ? "❌" : toast.type === "warning" ? "⚠️" : toast.type === "success" ? "✅" : "ℹ️"}</span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <span style={{ opacity: 0.5, fontSize: "16px" }}>✕</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyzingTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return undefined;
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - startTime) / 1000)),
      500
    );
    return () => clearInterval(interval);
  }, [startTime]);
  if (!startTime) return null;
  return <span style={{ fontSize: "12px", color: C.textMuted, fontVariantNumeric: "tabular-nums" }}>{elapsed}s</span>;
}
