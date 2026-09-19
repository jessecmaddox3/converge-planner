export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i;

export async function readJsonWithLimit(req: Request, maxBytes: number): Promise<unknown> {
  const contentType = req.headers.get("content-type") || "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  const reader = req.body?.getReader();
  if (!reader) {
    throw new ApiError(400, "INVALID_JSON", "Request body must contain valid JSON");
  }

  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    byteCount += value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must contain valid JSON");
  }
}

export function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonError(error: unknown, requestId = crypto.randomUUID()): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL_ERROR", "Internal server error");

  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (apiError.retryAfter !== undefined) {
    headers.set("retry-after", String(apiError.retryAfter));
  }
  const publicMessage = apiError.status >= 500 ? "Internal server error" : apiError.message;

  return withRequestId(
    new Response(
      JSON.stringify({
        error: {
          code: apiError.code,
          message: publicMessage,
          requestId,
        },
      }),
      { status: apiError.status, headers }
    ),
    requestId
  );
}
