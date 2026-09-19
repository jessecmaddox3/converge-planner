import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: auth }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { GET } from "./route";
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
it("does not use a browser Google token or make provider requests", async () => {
  auth.mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it("directs old signed-in tabs to the bounded calendar scan", async () => {
  auth.mockResolvedValue({ user: { actorId: "a" } });
  expect((await GET()).status).toBe(410);
  expect(fetch).not.toHaveBeenCalled();
});
