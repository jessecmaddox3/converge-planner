// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCalendarScan } from "./useCalendarScan";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("discards old calendar results if the signed-in account changes during a scan", async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ id: "primary", name: "Private A", primary: true }]),
      ),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(
    ({ account }) =>
      useCalendarScan(
        { startDate: "2026-10-01", endDate: "2026-10-31", timeZone: "UTC" },
        true,
        account,
      ),
    { initialProps: { account: "a" } },
  );
  await act(async () => {
    await result.current.connect();
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.scan();
  });
  rerender({ account: "b" });
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({
          current: {
            events: [{ title: "Private A event" }],
            coverage: { status: "complete" },
          },
          history: [],
        }),
      ),
    );
    await pending;
  });
  expect(result.current.result).toBeNull();
  expect(result.current.calendars).toEqual([]);
  expect(result.current.busy).toBe(false);
});

it("offers a real reconnect state for expired Google access", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
          status: 401,
        }),
      ),
  );
  const { result } = renderHook(() =>
    useCalendarScan(
      { startDate: "2026-10-01", endDate: "2026-10-31", timeZone: "UTC" },
      true,
      "a",
    ),
  );
  await act(async () => {
    await result.current.connect();
  });
  expect(result.current.needsReconnect).toBe(true);
  expect(result.current.error).toMatch(/Reconnect/);
});
