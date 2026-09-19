"use client";

import { useEffect, useRef, useState } from "react";
import { LOG_LEVEL_COLORS, logger } from "@/lib/client-logger";

const C = {
  primary: "#1B4332",
  textMuted: "#6B7280",
  border: "#E5E1DB",
};

export function DebugDrawer({ isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [textCopied, setTextCopied] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    setLogs(logger.getLogs());
    return logger.subscribe(() => setLogs(logger.getLogs()));
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, filter]);

  if (!isOpen) return null;

  const categories = ["ALL", ...new Set(logs.map((entry) => entry.category))];
  const filtered = logs.filter((entry) => {
    if (filter !== "ALL" && entry.level !== filter) return false;
    if (categoryFilter !== "ALL" && entry.category !== categoryFilter) return false;
    if (
      search &&
      !entry.message.toLowerCase().includes(search.toLowerCase()) &&
      !entry.category.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
  const stats = {
    total: logs.length,
    errors: logs.filter((entry) => entry.level === "ERROR" || entry.level === "FATAL").length,
  };

  const copy = (promiseFactory, setter) => {
    promiseFactory().then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "85vh", background: "#1E1E2E", borderRadius: "20px 20px 0 0", display: "flex", flexDirection: "column", overflow: "hidden", animation: "slideUp 0.3s ease" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#3E3E4E" }} />
        </div>

        <div style={{ padding: "12px 20px", borderBottom: "1px solid #2E2E3E", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "15px", color: "#E4E4E7", display: "flex", alignItems: "center", gap: "8px" }}>
              🔧 Debug Console
              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "10px", background: "#2E2E3E", color: "#A1A1AA", fontWeight: 500 }}>{stats.total}</span>
              {stats.errors > 0 && <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "10px", background: "#7F1D1D", color: "#FCA5A5", fontWeight: 500 }}>{stats.errors} errors</span>}
            </div>
            <div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px" }}>Session {logger.getSessionInfo().sessionId}</div>
          </div>
          <button onClick={onClose} style={{ background: "#2E2E3E", border: "none", color: "#A1A1AA", width: 32, height: 32, borderRadius: "8px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        <div style={{ padding: "10px 20px", borderBottom: "1px solid #2E2E3E", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
            {["ALL", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map((level) => (
              <button key={level} onClick={() => setFilter(level)} style={{ padding: "4px 10px", borderRadius: "6px", border: "none", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: filter === level ? (level === "ALL" ? "#3B82F6" : LOG_LEVEL_COLORS[level] || "#3B82F6") : "#2E2E3E", color: filter === level ? "#fff" : "#A1A1AA", opacity: filter === level ? 1 : 0.7 }}>
                {level}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input placeholder="Search logs..." value={search} onChange={(event) => setSearch(event.target.value)} style={{ flex: 1, padding: "6px 10px", borderRadius: "8px", border: "1px solid #2E2E3E", background: "#16161E", color: "#E4E4E7", fontSize: "12px", fontFamily: "inherit", outline: "none" }} />
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid #2E2E3E", background: "#16161E", color: "#E4E4E7", fontSize: "11px", fontFamily: "inherit" }}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "8px 12px", fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#6B7280", fontSize: "13px" }}>{logs.length === 0 ? "No logs yet" : "No logs match filters"}</div>
          ) : filtered.map((entry) => (
            <div key={entry.id} style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "11px", lineHeight: 1.6, borderLeft: "3px solid " + (LOG_LEVEL_COLORS[entry.level] || "#3B82F6"), marginBottom: "2px", background: entry.level === "ERROR" || entry.level === "FATAL" ? "rgba(127,29,29,0.15)" : "transparent" }}>
              <span style={{ color: "#6B7280" }}>{entry.localTime}</span>{" "}
              <span style={{ color: LOG_LEVEL_COLORS[entry.level], fontWeight: 600 }}>{entry.level.padEnd(5)}</span>{" "}
              <span style={{ color: "#6EE7B7" }}>[{entry.category}]</span>{" "}
              <span style={{ color: "#E4E4E7" }}>{entry.message}</span>
              {entry.data && <div style={{ color: "#8B95A5", marginLeft: "16px", fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 1).substring(0, 300)}</div>}
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid #2E2E3E", flexShrink: 0, display: "flex", gap: "8px" }}>
          <button onClick={() => copy(() => navigator.clipboard.writeText(logger.exportAsText()), setTextCopied)} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #2E2E3E", background: textCopied ? "#16A34A" : "#16161E", color: textCopied ? "#fff" : "#A1A1AA", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {textCopied ? "✓ Copied!" : "📋 Text"}
          </button>
          <button onClick={() => copy(() => navigator.clipboard.writeText(logger.exportAsJSON()), setJsonCopied)} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #2E2E3E", background: jsonCopied ? "#16A34A" : "#16161E", color: jsonCopied ? "#fff" : "#A1A1AA", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {jsonCopied ? "✓ Copied!" : "{ } JSON"}
          </button>
          <button onClick={() => { logger.clear(); setLogs([]); }} style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid #7F1D1D", background: "transparent", color: "#FCA5A5", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>
        </div>
      </div>
    </div>
  );
}

export function AnalyzeDebugTools({ onCopyLogs, onCancel }) {
  const [visible, setVisible] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  useEffect(() => {
    const visibleTimer = setTimeout(() => setVisible(true), 5000);
    const cancelTimer = setTimeout(() => setShowCancel(true), 10000);
    return () => {
      clearTimeout(visibleTimer);
      clearTimeout(cancelTimer);
    };
  }, []);
  if (!visible) return null;
  return (
    <div style={{ marginTop: "20px", width: "100%", maxWidth: "300px", animation: "fadeUp 0.3s ease" }}>
      <div style={{ height: 1, background: C.border, marginBottom: "16px" }} />
      <div style={{ fontSize: "11px", color: C.textMuted, textAlign: "center", marginBottom: "10px" }}>Taking longer than expected?</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onCopyLogs} style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "1.5px solid " + C.primary, background: "transparent", color: C.primary, fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          Copy Logs
        </button>
        {showCancel && <button onClick={onCancel} style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "1.5px solid " + C.border, background: "transparent", color: C.textMuted, fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>}
      </div>
    </div>
  );
}
