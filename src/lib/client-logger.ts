"use client";

export const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 } as const;
export const LOG_LEVEL_LABELS = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
export const LOG_LEVEL_COLORS: Record<string, string> = {
  DEBUG: "#8B95A5",
  INFO: "#3B82F6",
  WARN: "#E67E22",
  ERROR: "#C0392B",
  FATAL: "#7B2D26",
};

type LogData = unknown;

export interface ClientLogEntry {
  id: number;
  timestamp: string;
  localTime: string;
  level: string;
  category: string;
  message: string;
  data: LogData;
}

function safeSerialize(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[max depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => safeSerialize(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 30)) {
      try {
        result[key] = safeSerialize((value as Record<string, unknown>)[key], depth + 1);
      } catch {
        result[key] = "[unserializable]";
      }
    }
    return result;
  }
  return String(value);
}

export function createLogger() {
  let logs: ClientLogEntry[] = [];
  let listeners: Array<(entry: ClientLogEntry, logs: ClientLogEntry[]) => void> = [];
  const maxLogs = 2000;
  const sessionId = Math.random().toString(36).substring(2, 10);
  const sessionStart = new Date().toISOString();

  function emit(level: number, category: string, message: string, data: LogData = null) {
    const entry: ClientLogEntry = {
      id: logs.length,
      timestamp: new Date().toISOString(),
      localTime: new Date().toLocaleTimeString("en-US", {
        hour12: false,
        fractionalSecondDigits: 3,
      }),
      level: LOG_LEVEL_LABELS[level] || "INFO",
      category,
      message,
      data: data ? safeSerialize(data) : null,
    };
    logs.push(entry);
    if (logs.length > maxLogs) logs = logs.slice(-maxLogs);
    listeners.forEach((listener) => {
      try {
        listener(entry, logs);
      } catch {
        // Logging must never break the application.
      }
    });
    const consoleFn = level >= 3 ? console.error : level >= 2 ? console.warn : console.log;
    consoleFn(`[${entry.localTime}] [${entry.level}] [${category}] ${message}`, data || "");
    return entry;
  }

  return {
    debug: (category: string, message: string, data?: LogData) =>
      emit(LOG_LEVELS.DEBUG, category, message, data),
    info: (category: string, message: string, data?: LogData) =>
      emit(LOG_LEVELS.INFO, category, message, data),
    warn: (category: string, message: string, data?: LogData) =>
      emit(LOG_LEVELS.WARN, category, message, data),
    error: (category: string, message: string, data?: LogData) =>
      emit(LOG_LEVELS.ERROR, category, message, data),
    fatal: (category: string, message: string, data?: LogData) =>
      emit(LOG_LEVELS.FATAL, category, message, data),
    getLogs: () => [...logs],
    getSessionInfo: () => ({
      sessionId,
      sessionStart,
      logCount: logs.length,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    }),
    subscribe: (listener: (entry: ClientLogEntry, logs: ClientLogEntry[]) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
    exportAsText: (filter: ((entry: ClientLogEntry) => boolean) | null = null) => {
      const header = [
        "═══════════════════════════════════════",
        "CONVERGE DEBUG LOG EXPORT",
        "Session: " + sessionId,
        "Started: " + sessionStart,
        "Exported: " + new Date().toISOString(),
        "User Agent: " + (typeof navigator !== "undefined" ? navigator.userAgent : "unknown"),
        "Viewport: " +
          (typeof window !== "undefined" ? window.innerWidth + "x" + window.innerHeight : "unknown"),
        "Total Entries: " + logs.length,
        "═══════════════════════════════════════",
        "",
      ].join("\n");
      const filtered = filter ? logs.filter(filter) : logs;
      const body = filtered.map((entry) => {
        let line =
          "[" +
          entry.localTime +
          "] [" +
          entry.level.padEnd(5) +
          "] [" +
          entry.category.padEnd(16) +
          "] " +
          entry.message;
        if (entry.data) {
          try {
            const serialized = JSON.stringify(entry.data, null, 2);
            line += serialized.length > 200
              ? "\n    DATA: " +
                serialized.substring(0, 500) +
                (serialized.length > 500 ? "... (truncated)" : "")
              : " | " + serialized;
          } catch {
            line += " | [data unserializable]";
          }
        }
        return line;
      }).join("\n");
      return header + body;
    },
    exportAsJSON: () =>
      JSON.stringify(
        {
          session: {
            sessionId,
            sessionStart,
            exportedAt: new Date().toISOString(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
            viewport:
              typeof window !== "undefined"
                ? window.innerWidth + "x" + window.innerHeight
                : "unknown",
          },
          logs,
        },
        null,
        2
      ),
    clear: () => {
      logs = [];
    },
  };
}

export const logger = createLogger();
