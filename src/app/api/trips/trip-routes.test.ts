import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { newCapability } from "@/lib/actor";

const boundaryMocks = vi.hoisted(() => ({
  after: vi.fn(),
  authOptions: { test: "auth-options" },
  createTransport: vi.fn(),
  getServerSession: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: boundaryMocks.after,
}));
async function flushBackground() {
  const work = boundaryMocks.after.mock.calls
    .splice(0)
    .map(([callback]) => callback());
  await Promise.all(work);
}

vi.mock("next-auth", () => ({
  getServerSession: boundaryMocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: boundaryMocks.authOptions,
}));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceClient: boundaryMocks.getSupabaseServiceClient,
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: boundaryMocks.createTransport,
  },
}));

import {
  __resetMemoryStore,
  createTrip,
  getManagedTrip,
  type Actor,
} from "@/lib/store";
import * as storeModule from "@/lib/store";
import { POST as createRoute, GET as listRoute } from "@/app/api/trips/route";
import { GET as publicRoute } from "@/app/api/trips/[tripId]/route";
import { GET as viewerRoute } from "@/app/api/trips/[tripId]/me/route";
import { PUT as availabilityRoute } from "@/app/api/trips/[tripId]/availability/route";
import { GET as manageRoute } from "@/app/api/trips/[tripId]/manage/route";
import { PUT as confirmationRoute } from "@/app/api/trips/[tripId]/confirmation/route";
import { POST as reopenRoute } from "@/app/api/trips/[tripId]/reopen/route";
import { POST as compatibilityRespondRoute } from "@/app/api/trips/[tripId]/respond/route";
import { POST as compatibilityConfirmRoute } from "@/app/api/trips/[tripId]/confirm/route";
import { PUT as planningRoute } from "@/app/api/trips/[tripId]/planning/route";

const organizer: Actor = {
  actorKey: "account:organizer",
  kind: "account",
  name: "Quinn",
  email: "quinn@example.com",
};

const otherAccount: Actor = {
  actorKey: "account:other",
  kind: "account",
  name: "Other",
  email: "other@example.com",
};

const secondRespondent: Actor = {
  actorKey: "account:second-respondent",
  kind: "account",
  name: "Second",
  email: "second@example.com",
};

const tripInput = {
  name: "Seed Library Field Days",
  startDate: "2037-01-01",
  endDate: "2037-01-31",
  duration: 3,
  durationPreset: "weekend",
  notes: "Bring sunscreen",
  organizerName: "Spoofed Organizer",
  organizerEmail: "spoofed@example.com",
  selectedDates: ["2037-01-09", "2037-01-16"],
};

it("keeps planning changes organizer-only and blocks responses after closure", async () => {
  const tripId = await createTrip(tripInput, organizer);
  const planning = {
    revision: 0,
    requiredResponseIds: [],
    expectedPeople: [
      { id: "expected", name: "Private roster", required: true },
    ],
    invitationsClosed: true,
  };
  useSession(otherAccount);
  expect(
    (
      await planningRoute(
        request(`/api/trips/${tripId}/planning`, "PUT", planning),
        context(tripId),
      )
    ).status,
  ).toBe(403);
  useSession(organizer);
  expect(
    (
      await planningRoute(
        request(`/api/trips/${tripId}/planning`, "PUT", planning),
        context(tripId),
      )
    ).status,
  ).toBe(200);
  expect(
    await (
      await publicRoute(request(`/api/trips/${tripId}`), context(tripId))
    ).text(),
  ).not.toContain("Private roster");
  useSession(otherAccount);
  expect(
    (
      await availabilityRoute(
        request(`/api/trips/${tripId}/availability`, "PUT", {
          name: "Guest",
          answerVersion: 2,
          answers: {},
        }),
        context(tripId),
      )
    ).status,
  ).toBe(409);
});

type RouteContext = { params: Promise<{ tripId: string }> };

function sessionFor(actor: Actor) {
  return {
    user: {
      actorId: actor.actorKey,
      name: actor.name,
      email: actor.email,
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

let expectedActor = "anonymous";
function useSession(actor: Actor | null): void {
  expectedActor = actor?.actorKey || "anonymous";
  boundaryMocks.getServerSession.mockResolvedValue(
    actor ? sessionFor(actor) : null,
  );
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method,
    headers: {
      "X-Converge-Actor": expectedActor,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`https://converge.test${path}`, init);
}

function rawRequest(
  path: string,
  method: string,
  body: string,
  contentType = "application/json",
): NextRequest {
  return new NextRequest(`https://converge.test${path}`, {
    method,
    headers: { "content-type": contentType, "X-Converge-Actor": expectedActor },
    body,
  });
}

function context(tripId: string): RouteContext {
  return { params: Promise.resolve({ tripId }) };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function createOwnedTrip(): Promise<string> {
  return createTrip(tripInput, organizer);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GMAIL_USER", "test@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "test");
  boundaryMocks.getSupabaseServiceClient.mockReturnValue(null);
  boundaryMocks.createTransport.mockReturnValue({
    sendMail: boundaryMocks.sendMail,
    close: vi.fn(),
  });
  boundaryMocks.sendMail.mockResolvedValue({ messageId: "message-1" });
  useSession(organizer);
  __resetMemoryStore();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("durable trip routes", () => {
  it("requires an account session to create and ignores body organizer identity", async () => {
    useSession(null);
    const denied = await createRoute(request("/api/trips", "POST", tripInput));
    expect(denied.status).toBe(401);

    useSession(organizer);
    const created = await createRoute(request("/api/trips", "POST", tripInput));
    expect(created.status).toBe(200);
    const { id } = await json(created);
    expect(typeof id).toBe("string");

    const managed = await getManagedTrip(id as string, organizer);
    expect(managed.organizerName).toBe("Quinn");
    expect(managed.organizerEmail).toBe("quinn@example.com");
    await expect(getManagedTrip(id as string, otherAccount)).rejects.toThrow(
      "Forbidden",
    );
  });

  it("uses bounded JSON and semantic validation for trip creation", async () => {
    const wrongType = await createRoute(
      rawRequest("/api/trips", "POST", "{}", "text/plain"),
    );
    expect(wrongType.status).toBe(415);

    const tooLarge = await createRoute(
      rawRequest(
        "/api/trips",
        "POST",
        JSON.stringify({ padding: "x".repeat(20_000) }),
      ),
    );
    expect(tooLarge.status).toBe(413);

    const invalid = await createRoute(
      request("/api/trips", "POST", {
        ...tripInput,
        selectedDates: ["2037-01-10"],
      }),
    );
    expect(invalid.status).toBe(422);
  });

  it("lists only the signed actor's sanitized trip summaries", async () => {
    const ownedId = await createOwnedTrip();
    const otherId = await createTrip(
      { ...tripInput, name: "Other Trip" },
      otherAccount,
    );

    const response = await listRoute(request("/api/trips?mine=1"));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.trips).toEqual([
      expect.objectContaining({ id: ownedId, role: "organizer" }),
    ]);
    expect(JSON.stringify(body)).not.toContain("example.com");
    expect(JSON.stringify(body)).not.toContain("account:");
    expect(JSON.stringify(body)).not.toContain(otherId);

    useSession(null);
    expect((await listRoute(request("/api/trips?mine=1"))).status).toBe(401);
  });

  it("keeps the public trip projection free of identity secrets", async () => {
    const tripId = await createOwnedTrip();
    const capability = newCapability();
    useSession(null);
    await availabilityRoute(
      request(
        `/api/trips/${tripId}/availability`,
        "PUT",
        {
          name: "Alex",
          email: "spoofed@example.com",
          selectedDates: ["2037-01-09"],
          preferences: { "2037-01-09": "preferred" },
          conflictCount: 0,
        },
        {
          authorization: `Capability ${capability.token}`,
        },
      ),
      context(tripId),
    );

    const response = await publicRoute(
      request(`/api/trips/${tripId}`),
      context(tripId),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("capability:");
    expect(text).not.toContain(capability.token);
  });

  it("recognizes account and capability viewers without exposing another capability's ownership", async () => {
    const tripId = await createOwnedTrip();
    const firstCapability = newCapability();
    const wrongCapability = newCapability();

    useSession(otherAccount);
    expect(
      (
        await availabilityRoute(
          request(`/api/trips/${tripId}/availability`, "PUT", {
            name: "Signed Respondent",
            selectedDates: [],
          }),
          context(tripId),
        )
      ).status,
    ).toBe(200);
    const signedState = await viewerRoute(
      request(`/api/trips/${tripId}/me`),
      context(tripId),
    );
    expect(await json(signedState)).toMatchObject({
      role: "respondent",
      response: { name: "Signed Respondent", selectedDates: [] },
    });

    useSession(null);
    expect(
      (
        await availabilityRoute(
          request(
            `/api/trips/${tripId}/availability`,
            "PUT",
            {
              name: "Alex",
              selectedDates: ["2037-01-09"],
            },
            {
              authorization: `Capability ${firstCapability.token}`,
            },
          ),
          context(tripId),
        )
      ).status,
    ).toBe(200);

    const ownState = await viewerRoute(
      request(`/api/trips/${tripId}/me`, "GET", undefined, {
        authorization: `Capability ${firstCapability.token}`,
      }),
      context(tripId),
    );
    expect(await json(ownState)).toMatchObject({
      role: "respondent",
      response: { name: "Alex", selectedDates: ["2037-01-09"] },
    });

    const wrongState = await viewerRoute(
      request(`/api/trips/${tripId}/me`, "GET", undefined, {
        authorization: `Capability ${wrongCapability.token}`,
      }),
      context(tripId),
    );
    expect(await json(wrongState)).toMatchObject({
      role: "viewer",
      response: null,
    });
  });

  it("keeps an explicit private response identity after Google sign-in and uses the session email", async () => {
    const tripId = await createOwnedTrip();
    const capability = newCapability();
    const headers = { authorization: `Capability ${capability.token}` };
    useSession(null);
    const first = await json(
      await availabilityRoute(
        request(
          `/api/trips/${tripId}/availability`,
          "PUT",
          { name: "Alex", selectedDates: ["2037-01-09"] },
          headers,
        ),
        context(tripId),
      ),
    );
    useSession(otherAccount);
    const updated = await json(
      await availabilityRoute(
        request(
          `/api/trips/${tripId}/availability`,
          "PUT",
          {
            name: "Alex",
            selectedDates: ["2037-01-16"],
            email: "wrong@example.com",
          },
          headers,
        ),
        context(tripId),
      ),
    );
    expect(updated).toMatchObject({
      response: {
        publicId: (first.response as { publicId: string }).publicId,
        email: otherAccount.email,
      },
    });
    const publicView = await json(
      await publicRoute(request(`/api/trips/${tripId}`), context(tripId)),
    );
    expect(publicView.responses).toHaveLength(1);
  });

  it("does not let a wrong capability replace another actor's response", async () => {
    const tripId = await createOwnedTrip();
    const firstCapability = newCapability();
    const secondCapability = newCapability();
    useSession(null);

    await availabilityRoute(
      request(
        `/api/trips/${tripId}/availability`,
        "PUT",
        {
          name: "Alex",
          selectedDates: ["2037-01-09"],
        },
        {
          authorization: `Capability ${firstCapability.token}`,
        },
      ),
      context(tripId),
    );
    await availabilityRoute(
      request(
        `/api/trips/${tripId}/availability`,
        "PUT",
        {
          name: "Alex",
          selectedDates: ["2037-01-16"],
        },
        {
          authorization: `Capability ${secondCapability.token}`,
        },
      ),
      context(tripId),
    );

    const managed = await getManagedTrip(tripId, organizer);
    expect(managed.responses).toHaveLength(2);
    expect(managed.responses.map((response) => response.selectedDates)).toEqual(
      [["2037-01-09"], ["2037-01-16"]],
    );
  });

  it("requires an actor and rejects availability outside organizer candidates", async () => {
    const tripId = await createOwnedTrip();
    useSession(null);

    const anonymous = await availabilityRoute(
      request(`/api/trips/${tripId}/availability`, "PUT", {
        name: "Alex",
        selectedDates: [],
      }),
      context(tripId),
    );
    expect(anonymous.status).toBe(401);

    const capability = newCapability();
    const invalid = await availabilityRoute(
      request(
        `/api/trips/${tripId}/availability`,
        "PUT",
        {
          name: "Alex",
          selectedDates: ["2037-01-23"],
        },
        {
          authorization: `Capability ${capability.token}`,
        },
      ),
      context(tripId),
    );
    expect(invalid.status).toBe(422);
  });

  it("requires organizer authority for management", async () => {
    const tripId = await createOwnedTrip();

    useSession(null);
    expect(
      (
        await manageRoute(
          request(`/api/trips/${tripId}/manage`),
          context(tripId),
        )
      ).status,
    ).toBe(401);

    useSession(otherAccount);
    expect(
      (
        await manageRoute(
          request(`/api/trips/${tripId}/manage`),
          context(tripId),
        )
      ).status,
    ).toBe(403);

    useSession(organizer);
    const allowed = await manageRoute(
      request(`/api/trips/${tripId}/manage`),
      context(tripId),
    );
    expect(allowed.status).toBe(200);
    expect(await json(allowed)).toMatchObject({
      id: tripId,
      organizerEmail: "quinn@example.com",
      status: "collecting",
    });
  });

  it("claims matching-email legacy management without opening anonymous or wrong-email access", async () => {
    const legacyTripId = await createTrip({
      ...tripInput,
      organizerName: "Legacy Quinn",
      organizerEmail: "QUINN@example.com",
    });

    useSession(null);
    expect(
      (
        await manageRoute(
          request(`/api/trips/${legacyTripId}/manage`),
          context(legacyTripId),
        )
      ).status,
    ).toBe(401);

    useSession(otherAccount);
    expect(
      (
        await manageRoute(
          request(`/api/trips/${legacyTripId}/manage`),
          context(legacyTripId),
        )
      ).status,
    ).toBe(403);

    useSession(organizer);
    const claimed = await manageRoute(
      request(`/api/trips/${legacyTripId}/manage`),
      context(legacyTripId),
    );
    expect(claimed.status).toBe(200);
    expect(await json(claimed)).toMatchObject({
      id: legacyTripId,
      organizerName: "Legacy Quinn",
      organizerEmail: "quinn@example.com",
    });
    await expect(
      getManagedTrip(legacyTripId, organizer),
    ).resolves.toMatchObject({ id: legacyTripId });
  });

  it("confirms once, treats a same-date retry as a no-op, and rejects a competing date", async () => {
    const tripId = await createOwnedTrip();

    const first = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({
      confirmedDate: "2037-01-09",
      confirmationVersion: 1,
      alreadyConfirmed: false,
    });

    const retry = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );
    expect(retry.status).toBe(200);
    expect(await json(retry)).toMatchObject({
      confirmationVersion: 1,
      alreadyConfirmed: true,
    });

    const competing = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-16",
      }),
      context(tripId),
    );
    expect(competing.status).toBe(409);
  });

  it("sends confirmation email work once and not on a same-date retry", async () => {
    const tripId = await createOwnedTrip();
    useSession(otherAccount);
    await availabilityRoute(
      request(`/api/trips/${tripId}/availability`, "PUT", {
        name: "Other",
        selectedDates: ["2037-01-09"],
      }),
      context(tripId),
    );

    useSession(organizer);
    const first = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );
    expect(await json(first)).toMatchObject({
      alreadyConfirmed: false,
      notifications: { pending: 1, sent: 0, total: 1 },
    });
    await flushBackground();
    expect(boundaryMocks.sendMail).toHaveBeenCalledTimes(1);

    const retry = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );
    expect(await json(retry)).toMatchObject({
      alreadyConfirmed: true,
      notifications: { pending: 0, sent: 1, total: 1 },
    });
    await flushBackground();
    expect(boundaryMocks.sendMail).toHaveBeenCalledTimes(1);
  });

  it("retries only failed deliveries after backoff on a same-date request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const tripId = await createOwnedTrip();
    useSession(otherAccount);
    await availabilityRoute(
      request(`/api/trips/${tripId}/availability`, "PUT", {
        name: "Other",
        selectedDates: ["2037-01-09"],
      }),
      context(tripId),
    );
    useSession(secondRespondent);
    await availabilityRoute(
      request(`/api/trips/${tripId}/availability`, "PUT", {
        name: "Second",
        selectedDates: ["2037-01-09"],
      }),
      context(tripId),
    );
    boundaryMocks.sendMail
      .mockReset()
      .mockResolvedValueOnce({ messageId: "message-1" })
      .mockRejectedValueOnce(new Error("temporary SMTP failure"))
      .mockResolvedValueOnce({ messageId: "message-2" });

    useSession(organizer);
    const first = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );
    expect(await json(first)).toMatchObject({
      alreadyConfirmed: false,
      notifications: { pending: 2, sent: 0, total: 2 },
    });
    await flushBackground();
    expect(boundaryMocks.sendMail).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 61000);

    const retry = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );
    expect(await json(retry)).toMatchObject({
      alreadyConfirmed: true,
      notifications: { failed: 1, sent: 1, total: 2 },
    });
    await flushBackground();
    expect(boundaryMocks.sendMail).toHaveBeenCalledTimes(3);
    expect(boundaryMocks.sendMail.mock.calls[2][0]).toMatchObject({
      to: "second@example.com",
    });
  });

  it("continues sending after delivery bookkeeping fails", async () => {
    const tripId = await createOwnedTrip();
    for (const actor of [otherAccount, secondRespondent]) {
      useSession(actor);
      await availabilityRoute(
        request(`/api/trips/${tripId}/availability`, "PUT", {
          name: actor.name,
          selectedDates: ["2037-01-09"],
        }),
        context(tripId),
      );
    }
    vi.spyOn(storeModule, "finishNotification").mockRejectedValueOnce(
      new Error("temporary completion storage failure"),
    );

    useSession(organizer);
    const response = await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      notifications: { pending: 2, sent: 0, total: 2 },
    });
    await flushBackground();
    expect(boundaryMocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it("returns 409 for availability after confirmation and accepts it after reopen", async () => {
    const tripId = await createOwnedTrip();
    await confirmationRoute(
      request(`/api/trips/${tripId}/confirmation`, "PUT", {
        confirmedDate: "2037-01-09",
      }),
      context(tripId),
    );

    useSession(otherAccount);
    const locked = await availabilityRoute(
      request(`/api/trips/${tripId}/availability`, "PUT", {
        name: "Other",
        selectedDates: [],
      }),
      context(tripId),
    );
    expect(locked.status).toBe(409);

    useSession(organizer);
    const reopened = await reopenRoute(
      request(`/api/trips/${tripId}/reopen`, "POST"),
      context(tripId),
    );
    expect(reopened.status).toBe(200);
    expect(await json(reopened)).toMatchObject({
      status: "collecting",
      confirmedDate: null,
      confirmationVersion: 1,
    });

    useSession(otherAccount);
    expect(
      (
        await availabilityRoute(
          request(`/api/trips/${tripId}/availability`, "PUT", {
            name: "Other",
            selectedDates: [],
          }),
          context(tripId),
        )
      ).status,
    ).toBe(200);
  });

  it("cuts compatibility write routes over without trusting body identity", async () => {
    const tripId = await createOwnedTrip();
    useSession(otherAccount);

    const submitted = await compatibilityRespondRoute(
      request(`/api/trips/${tripId}/respond`, "POST", {
        name: "Other",
        email: "spoofed@example.com",
        actorKey: organizer.actorKey,
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      }),
      context(tripId),
    );
    expect(submitted.status).toBe(200);

    const managed = await getManagedTrip(tripId, organizer);
    expect(managed.responses[0].email).toBe("other@example.com");

    useSession(organizer);
    const confirmed = await compatibilityConfirmRoute(
      request(`/api/trips/${tripId}/confirm`, "POST", {
        confirmedDate: "2037-01-09",
        actorKey: otherAccount.actorKey,
      }),
      context(tripId),
    );
    expect(confirmed.status).toBe(200);
    expect(await json(confirmed)).toMatchObject({
      success: true,
      confirmedDate: "2037-01-09",
      confirmationVersion: 1,
      alreadyConfirmed: false,
    });
  });
});


describe("displayed identity stays bound to private requests", () => {
  it("rejects stale account creation and availability before either account changes", async () => {
    const tripId = await createOwnedTrip();
    useSession(otherAccount);
    const headers = {"X-Converge-Actor": organizer.actorKey};
    expect((await createRoute(request('/api/trips','POST',tripInput,headers))).status).toBe(409);
    expect((await availabilityRoute(request(`/api/trips/${tripId}/availability`,'PUT',{name:'Old tab',answerVersion:2,answers:{}},headers),context(tripId))).status).toBe(409);
    expect((await getManagedTrip(tripId, organizer)).responses).toHaveLength(0);
    expect((await (await listRoute(request('/api/trips?mine=1'))).json()).trips).toHaveLength(0);
  });
  it("does not attach a newly signed-in account to an anonymous capability form", async () => {
    const tripId = await createOwnedTrip();
    useSession(otherAccount);
    const response = await availabilityRoute(request(`/api/trips/${tripId}/availability`,'PUT',{name:'Anonymous tab',email:'guest@example.invalid',answerVersion:2,answers:{}},{'X-Converge-Actor':'anonymous',authorization:`Capability ${newCapability().token}`}),context(tripId));
    expect(response.status).toBe(409);
    expect((await getManagedTrip(tripId, organizer)).responses).toHaveLength(0);
  });
  it("requires an explicit expected actor, which is never authentication", async () => {
    expect((await listRoute(new NextRequest('https://converge.test/api/trips?mine=1'))).status).toBe(409);
    useSession(null);
    expect((await listRoute(request('/api/trips?mine=1','GET',undefined,{'X-Converge-Actor':organizer.actorKey}))).status).toBe(409);
  });
});
