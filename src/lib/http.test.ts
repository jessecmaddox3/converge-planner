import { describe, expect, it } from "vitest";
import {
  ApiError,
  jsonError,
  readJsonWithLimit,
  withRequestId,
} from "@/lib/http";

function request(contentType: string, body: BodyInit, contentLength?: number): Request {
  const headers = new Headers({ "content-type": contentType });
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Request("https://converge.test/api/test", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

describe("readJsonWithLimit", () => {
  it("rejects a non-JSON content type before reading", async () => {
    await expect(readJsonWithLimit(request("text/plain", "{}"), 16)).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it("accepts application/json with a charset", async () => {
    await expect(
      readJsonWithLimit(request("application/json; charset=utf-8", '{"ok":true}'), 32)
    ).resolves.toEqual({ ok: true });
  });

  it("rejects malformed JSON", async () => {
    await expect(readJsonWithLimit(request("application/json", '{"x":'), 16)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_JSON",
    });
  });

  it("rejects a declared body larger than the limit", async () => {
    await expect(
      readJsonWithLimit(request("application/json", "{}", 100), 16)
    ).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("rejects a streamed body once its bytes cross the limit", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"x":"'));
        controller.enqueue(encoder.encode('0123456789"}'));
        controller.close();
      },
    });

    await expect(readJsonWithLimit(request("application/json", body), 8)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});

describe("jsonError", () => {
  it("sanitizes unexpected server errors and includes the request ID", async () => {
    const response = jsonError(new Error("SUPABASE_SECRET"), "req-500");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req-500");
    expect(body).not.toContain("SUPABASE_SECRET");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: "req-500",
      },
    });
  });

  it("sanitizes the message of an ApiError with a 5xx status", async () => {
    const response = jsonError(
      new ApiError(502, "UPSTREAM_ERROR", "SUPABASE_SECRET"),
      "req-502"
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe("req-502");
    expect(body).not.toContain("SUPABASE_SECRET");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "UPSTREAM_ERROR",
        message: "Internal server error",
        requestId: "req-502",
      },
    });
  });

  it("preserves safe ApiError fields and emits Retry-After", async () => {
    const response = jsonError(
      new ApiError(429, "RATE_LIMITED", "Too many requests", 30),
      "req-429"
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId: "req-429",
      },
    });
  });
});

describe("withRequestId", () => {
  it("preserves the response while adding the request ID header", async () => {
    const response = withRequestId(
      new Response("ok", { status: 202, headers: { "x-existing": "yes" } }),
      "req-202"
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-existing")).toBe("yes");
    expect(response.headers.get("x-request-id")).toBe("req-202");
    await expect(response.text()).resolves.toBe("ok");
  });
});
