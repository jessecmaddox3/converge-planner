import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: auth }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { POST } from "./route";
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
it("keeps unauthenticated requests rejected", async () => {
  auth.mockResolvedValue(null);
  expect((await POST()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it("retires paid generic advice even when provider keys are configured", async () => {
  auth.mockResolvedValue({ user: { actorId: "a" } });
  const response = await POST();
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ error: { code: "RETIRED" } });
  expect(fetch).not.toHaveBeenCalled();
});
