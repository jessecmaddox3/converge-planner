import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ run: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/notification-worker", () => ({
  runNotificationWorker: mocks.run,
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));
import { GET } from "./route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("requires the configured cron bearer before any maintenance or delivery", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  expect(
    (
      await GET(
        new NextRequest("https://example.com/api/internal/notifications"),
      )
    ).status,
  ).toBe(401);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.run.mockResolvedValue({ sent: 0 });
  const response = await GET(
    new NextRequest("https://example.com/api/internal/notifications", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("cleanup_converge_storage");
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("recovers deliveries even when cache cleanup fails", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  mocks.rpc.mockResolvedValue({ error: { code: "unavailable" } });
  mocks.run.mockResolvedValue({ sent: 1 });
  const response = await GET(
    new NextRequest("https://example.com/api/internal/notifications", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    sent: 1,
    maintenanceCompleted: false,
  });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
