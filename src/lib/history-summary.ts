import { isDemo } from "./runtime/config";
import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { validateClusters, type SummaryCluster } from "./analysis";
import {
  AI_HISTORY_MAX_EVENTS,
  AI_HISTORY_MAX_OUTPUT_TOKENS,
  AI_HISTORY_MAX_USER_CHARS,
  historyEventUserChars,
  normalizeAIHistoryEvent,
  type AIHistoryEvent,
} from "./ai-inputs";
import { cachedJob } from "./cached-job";
import {
  reserveGeneration,
  recordGeneration,
  type GenerationUsage,
} from "./ai-budget";
import { consumeQuota } from "./rate-limit";
import { ApiError } from "./http";

export const HISTORY_MODEL = "gemini-3.5-flash-lite";
export const HISTORY_PROMPT_VERSION = "2026-09-12.1";
export const HISTORY_DEADLINE_MS = 20000;

export function parseHistoryEvents(body: unknown): AIHistoryEvent[] {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_REQUEST", "Invalid history request");
  }
  const events = (body as { events?: unknown }).events;
  if (
    !Array.isArray(events) ||
    events.length < 2 ||
    events.length > AI_HISTORY_MAX_EVENTS
  ) {
    throw new ApiError(400, "INVALID_REQUEST", "Invalid history request");
  }
  const out: AIHistoryEvent[] = [];
  const seenIds = new Set<string>();
  let userChars = 0;
  for (const e of events) {
    const normalized = normalizeAIHistoryEvent(e);
    if (!normalized) {
      throw new ApiError(400, "INVALID_REQUEST", "Invalid history request");
    }
    if (seenIds.has(normalized.id)) {
      throw new ApiError(400, "INVALID_REQUEST", "Invalid history request");
    }
    seenIds.add(normalized.id);
    userChars += historyEventUserChars(e);
    if (userChars > AI_HISTORY_MAX_USER_CHARS) {
      throw new ApiError(400, "INVALID_REQUEST", "Invalid history request");
    }
    out.push(normalized);
  }
  return out;
}

export const HISTORY_PROMPT = `You are grouping calendar events into real-world activities for a trip-planning app.

Below is a JSON array of a user's past calendar events. Identify groups of events that clearly belong to one real-world activity — for example a flight, hotel stay, and dinner reservation in the same city across the same date range form one trip; a multi-day conference's sessions form one conference.

Rules:
- Only group events when you are confident they belong together (shared location, contiguous or overlapping dates, complementary titles like flight + hotel).
- Do NOT group unrelated events that merely share dates.
- Recurring routine events (standups, classes, club meetings) stay ungrouped — leave them out entirely.
- Each event id may appear in at most one group. Groups need at least 2 events.
- "label": a short human name for the activity, max 40 characters, no dates in it (e.g. "Trip to San Francisco", "Acme annual conference").
- "emoji": one emoji that fits the activity.

Respond with ONLY this JSON, no other text:
{"clusters":[{"label":"...","emoji":"...","eventIds":["...","..."]}]}

If nothing should be grouped, respond {"clusters":[]}.

Events:
`;

export function historyCacheKey(
  actorKey: string,
  events: AIHistoryEvent[],
  timeZone: string,
): string {
  return (
    "history:" +
    createHash("sha256")
      .update(
        JSON.stringify([
          actorKey,
          HISTORY_MODEL,
          HISTORY_PROMPT_VERSION,
          timeZone,
          canonicalEvents(events),
        ]),
      )
      .digest("hex")
  );
}
function canonicalEvents(events: AIHistoryEvent[]) {
  return events
    .map((event) => normalizeAIHistoryEvent(event)!)
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function summarizeHistory(
  actorKey: string,
  events: AIHistoryEvent[],
  timeZone: string,
) {
  const normalized = canonicalEvents(events);
  const result = await cachedJob<{ clusters: SummaryCluster[]; model: string }>(
    historyCacheKey(actorKey, normalized, timeZone),
    {
      ttlSeconds: 604800,
      leaseSeconds: 30,
      generate: async () => {
        if (isDemo()) {
          // Demonstrate the same validation/cache path with visibly simulated output.
          // This never invokes a model or consumes a paid-provider budget.
          const flights = normalized.filter(event => /flight/i.test(event.title));
          const clusters = flights.length >= 2 ? validateClusters(normalized, {clusters: [{label: "Simulated flight grouping", emoji: "✈️", eventIds: flights.slice(0, 2).map(event => event.id)}]}) : [];
          return {clusters, model: 'Local simulation, no AI call'};
        }
        const apiKey = process.env.CONVERGE_ENABLE_AI === 'yes' || process.env.NODE_ENV === 'test' ? process.env.GEMINI_API_KEY : undefined;
        if (!apiKey)
          throw new ApiError(
            503,
            "AI_UNAVAILABLE",
            "History grouping is unavailable. You can still view the original events.",
          );
        for (const quota of [
          { windowSeconds: 3600, limit: 4 },
          { windowSeconds: 86400, limit: 10 },
        ]) {
          const response = await consumeQuota({
            actorKey,
            action: "ai-history-summary",
            ...quota,
          });
          if (!response.allowed)
            throw new ApiError(
              429,
              "RATE_LIMITED",
              "Too many history requests. Try again later.",
              response.retryAfter,
            );
        }
        const prompt = HISTORY_PROMPT + JSON.stringify(normalized);
        const reservation = await reserveGeneration(prompt);
        const usage: GenerationUsage = {
          model: HISTORY_MODEL,
          promptVersion: HISTORY_PROMPT_VERSION,
          eventCount: events.length,
          cacheHit: false,
          latencyMs: 0,
          inputTokens: null,
          outputTokens: null,
          thinkingTokens: null,
          finishReason: "provider_error",
          validated: false,
        };
        const started = Date.now();
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("deadline"));
          }, HISTORY_DEADLINE_MS);
        });
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
              timeout: HISTORY_DEADLINE_MS,
              retryOptions: { attempts: 1 },
            },
          });
          const response = await Promise.race([
            ai.models.generateContent({
              model: HISTORY_MODEL,
              contents: prompt,
              config: {
                abortSignal: controller.signal,
                responseMimeType: "application/json",
                maxOutputTokens: AI_HISTORY_MAX_OUTPUT_TOKENS,
                responseJsonSchema: {
                  type: "object",
                  required: ["clusters"],
                  additionalProperties: false,
                  properties: {
                    clusters: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["label", "emoji", "eventIds"],
                        additionalProperties: false,
                        properties: {
                          label: { type: "string" },
                          emoji: { type: "string" },
                          eventIds: {
                            type: "array",
                            items: { type: "string" },
                            minItems: 2,
                          },
                        },
                      },
                    },
                  },
                },
              },
            }),
            timeout,
          ]);
          const count = (value: unknown) =>
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0
              ? value
              : null;
          usage.inputTokens = count(response.usageMetadata?.promptTokenCount);
          usage.outputTokens = count(
            response.usageMetadata?.candidatesTokenCount,
          );
          usage.thinkingTokens = count(
            response.usageMetadata?.thoughtsTokenCount ?? 0,
          );
          usage.finishReason = String(
            response.candidates?.[0]?.finishReason || "unknown",
          ).slice(0, 40);
          const text = response.text?.trim();
          if (
            !text ||
            (response.candidates?.[0]?.finishReason &&
              response.candidates[0].finishReason !== "STOP")
          )
            throw new Error("incomplete output");
          const parsed = JSON.parse(
            text
              .replace(/^```[a-z]*\s*/i, "")
              .replace(/\s*```$/, "")
              .trim(),
          );
          if (!parsed || !Array.isArray(parsed.clusters))
            throw new Error("invalid structure");
          const clusters = validateClusters(normalized, parsed);
          if (parsed.clusters.length && !clusters.length)
            throw new Error("invalid groups");
          usage.validated = true;
          return { clusters, model: HISTORY_MODEL };
        } catch {
          if (controller.signal.aborted) usage.finishReason = "timeout";
          throw new ApiError(
            502,
            "UPSTREAM_ERROR",
            "History grouping could not finish. Your original calendar events are still available.",
          );
        } finally {
          clearTimeout(timer!);
          usage.latencyMs = Date.now() - started;
          // No raw calendar text, provider error messages, credentials, or account IDs.
          console.info("[ai-usage]", JSON.stringify(usage));
          try {
            await recordGeneration(reservation, usage);
          } catch {
            console.warn(
              "[ai-usage] Recording unavailable; conservative budget reservation retained",
            );
          }
        }
      },
    },
  );
  if (result.cacheHit)
    console.info(
      "[ai-usage]",
      JSON.stringify({
        model: HISTORY_MODEL,
        promptVersion: HISTORY_PROMPT_VERSION,
        cacheHit: true,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        latencyMs: 0,
        finishReason: "cached",
        validated: true,
      }),
    );
  return { ...result.value, cacheHit: result.cacheHit };
}
