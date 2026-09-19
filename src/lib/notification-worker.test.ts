import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("./supabase-server", () => ({ getSupabaseServiceClient: () => null }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail, close: vi.fn() }),
  },
}));
import {
  __resetMemoryStore,
  createTrip,
  submitAvailability,
  confirmTripOnce,
  claimNotificationBatch,
  finishNotification,
  notificationClaimIsCurrent,
  getNotificationSummary,
  reopenTrip,
  type Actor,
} from "./store";
import * as store from "./store";
import { runNotificationWorker } from "./notification-worker";
import { confirmationEmail } from "./confirmation-email";
const organizer: Actor = {
  kind: "account",
  actorKey: "account:organizer",
  name: "Jess",
  email: "jess@example.com",
};
async function confirmed() {
  const id = await createTrip(
    {
      name: "Coast <escape>",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      duration: 3,
      durationPreset: "weekend",
      notes: "",
      selectedDates: ["2026-10-09"],
    },
    organizer,
  );
  await submitAvailability(
    id,
    { kind: "capability", actorKey: "capability:a" },
    {
      name: "Alex",
      email: "alex@example.com",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      answerVersion: 2,
      answers: { "2026-10-09": "unavailable" },
    },
  );
  return confirmTripOnce(id, organizer, "2026-10-09");
}
beforeEach(() => {
  __resetMemoryStore();
  mocks.sendMail.mockReset().mockResolvedValue({ messageId: "test" });
  vi.stubEnv("GMAIL_USER", "test@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("notification worker", () => {
  it("notifies every respondent but labels actual availability truthfully", async () => {
    const result = await confirmed();
    const mail = confirmationEmail(result.trip);
    expect(mail.text).toContain("Available: Jess (organizer)");
    expect(mail.text).toContain("Cannot: Alex");
    expect(mail.html).toContain("Coast &lt;escape&gt;");
    await runNotificationWorker({ tripId: result.trip.id });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({
      to: "alex@example.com",
      attachments: [{ filename: "converge.ics" }],
    });
    expect(await getNotificationSummary(result.trip.id, 1)).toMatchObject({
      total: 1,
      sent: 1,
      pending: 0,
      failed: 0,
    });
    await runNotificationWorker({ tripId: result.trip.id });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });
  it("backs off failed deliveries and retains the same Message-ID on retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { trip } = await confirmed();
    mocks.sendMail.mockRejectedValueOnce(new Error("SMTP failed"));
    await runNotificationWorker({ tripId: trip.id });
    expect(await getNotificationSummary(trip.id, 1)).toMatchObject({
      failed: 1,
    });
    await runNotificationWorker({ tripId: trip.id });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61000);
    await runNotificationWorker({ tripId: trip.id });
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(mocks.sendMail.mock.calls[1][0].messageId).toBe(
      mocks.sendMail.mock.calls[0][0].messageId,
    );
  });
  it("releases a claim without using an attempt when there is no time left to send", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { trip } = await confirmed();
    const original = store.getTrip;
    vi.spyOn(store, "getTrip").mockImplementation(async (id) => {
      vi.setSystemTime(Date.now() + 26000);
      return original(id);
    });
    for (let i = 0; i < 9; i++)
      await runNotificationWorker({ tripId: trip.id });
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(await claimNotificationBatch(trip.id)).toHaveLength(1);
  });
  it("rejects stale lease completion and work from a reopened confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { trip } = await confirmed();
    const [first] = await claimNotificationBatch(trip.id, 3);
    expect(await claimNotificationBatch(trip.id, 3)).toEqual([]);
    vi.setSystemTime(Date.now() + 91000);
    const [second] = await claimNotificationBatch(trip.id, 3);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(await finishNotification(first, true)).toBe(false);
    await reopenTrip(trip.id, organizer);
    expect(await notificationClaimIsCurrent(second)).toBe(false);
    expect(await finishNotification(second, true)).toBe(false);
    await runNotificationWorker({ tripId: trip.id });
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
