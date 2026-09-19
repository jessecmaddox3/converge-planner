import { describe, it, expect, beforeEach, vi } from "vitest";

const { getSupabaseServiceClientMock } = vi.hoisted(() => ({
  getSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceClient: getSupabaseServiceClientMock,
}));

import {
  CapacityError,
  ConflictError,
  ForbiddenError,
  createTrip,
  getTrip,
  toPublicTrip,
  submitAvailability,
  getViewerState,
  getManagedTrip,
  updateTripPlanning,
  confirmTripOnce,
  claimConfirmationDeliveries,
  completeConfirmationDelivery,
  reopenTrip,
  listTripsForActor,
  __resetMemoryStore,
  type Actor,
} from "@/lib/store";

// These tests exercise the in-memory fallback (no KV env vars in test).
const tripInput = {
  name: "Seed Library Field Days",
  startDate: "2037-01-01",
  endDate: "2037-01-31",
  duration: 3,
  durationPreset: "weekend",
  notes: "",
  organizerName: "Quinn",
  organizerEmail: "quinn@example.com",
  selectedDates: ["2037-01-09", "2037-01-16"],
};

const organizer: Actor = {
  actorKey: "account:organizer",
  kind: "account",
  name: "Quinn",
  email: "QUINN@EXAMPLE.COM",
};
const otherAccount: Actor = {
  actorKey: "account:other",
  kind: "account",
  name: "Other",
  email: "other@example.com",
};
const sameNameActorA: Actor = {
  actorKey: "capability:alex-a",
  kind: "capability",
};
const sameNameActorB: Actor = {
  actorKey: "capability:alex-b",
  kind: "capability",
};

beforeEach(() => {
  getSupabaseServiceClientMock.mockReset();
  getSupabaseServiceClientMock.mockReturnValue(null);
  __resetMemoryStore();
});

describe("store (memory fallback)", () => {
  it("keeps organizer planning private and enforces closure and settings revisions", async () => {
    const id = await createTrip(
      {
        ...tripInput,
        timeZone: "America/New_York",
        departureTime: "18:00",
        returnTime: "18:00",
      },
      organizer,
    );
    const planning = {
      revision: 0,
      requiredResponseIds: [],
      expectedPeople: [{ id: "alex", name: "Alex expected", required: true }],
      invitationsClosed: true,
    };
    await expect(
      updateTripPlanning(id, otherAccount, planning),
    ).rejects.toThrow(ForbiddenError);
    const managed = await updateTripPlanning(id, organizer, planning);
    expect(managed.planning?.revision).toBe(1);
    const publicTrip = toPublicTrip(managed);
    expect(publicTrip).toMatchObject({
      timeZone: "America/New_York",
      departureTime: "18:00",
      invitationsClosed: true,
    });
    expect(JSON.stringify(publicTrip)).not.toContain("Alex expected");
    expect(JSON.stringify(publicTrip)).not.toContain("requiredResponseIds");
    await expect(updateTripPlanning(id, organizer, planning)).rejects.toThrow(
      /refresh/i,
    );
    await expect(
      submitAvailability(id, sameNameActorA, {
        name: "Alex",
        selectedDates: [],
        preferences: {},
        conflictCount: 0,
      }),
    ).rejects.toThrow(/closed/i);
  });
  it("round-trips partial answers and rejects a legacy edit that would turn unknown into No", async () => {
    const id = await createTrip(tripInput, organizer);
    const input = {
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      answerVersion: 2 as const,
      answers: { "2037-01-09": "maybe" as const },
    };
    await submitAvailability(id, sameNameActorA, input);
    expect((await getViewerState(id, sameNameActorA)).response).toMatchObject({
      answerVersion: 2,
      answers: { "2037-01-09": "maybe" },
    });
    await expect(
      submitAvailability(id, sameNameActorA, {
        name: "Alex",
        selectedDates: [],
        preferences: {},
        conflictCount: 0,
      }),
    ).rejects.toThrow(/refresh/i);
    expect((await getViewerState(id, sameNameActorA)).response).toMatchObject({
      answers: { "2037-01-09": "maybe" },
    });
  });
  it("create/get roundtrip", async () => {
    const id = await createTrip(tripInput);
    const trip = await getTrip(id);
    expect(trip).not.toBeNull();
    expect(trip!.name).toBe("Seed Library Field Days");
    expect(trip!.responses).toEqual([]);
    expect(trip!.confirmedDate).toBeNull();
  });

  it("submitAvailability stores and getTrip returns it", async () => {
    const id = await createTrip(tripInput);
    await submitAvailability(id, sameNameActorA, {
      name: "Reed",
      email: "reed@example.com",
      selectedDates: ["2037-01-09"],
      preferences: {},
      conflictCount: 0,
    });
    const trip = await getTrip(id);
    expect(trip!.responses).toHaveLength(1);
    expect(trip!.responses[0].name).toBe("Reed");
    expect(trip!.responses[0].submittedAt).toBeTruthy();
  });

  it("submitAvailability replaces the same capability response", async () => {
    const id = await createTrip(tripInput);
    await submitAvailability(id, sameNameActorA, {
      name: "Reed",
      email: "reed@example.com",
      selectedDates: ["2037-01-09"],
      preferences: {},
      conflictCount: 0,
    });
    await submitAvailability(id, sameNameActorA, {
      name: "Reed Vale",
      email: "reed@example.com",
      selectedDates: ["2037-01-16"],
      preferences: {},
      conflictCount: 1,
    });
    const trip = await getTrip(id);
    expect(trip!.responses).toHaveLength(1);
    expect(trip!.responses[0].selectedDates).toEqual(["2037-01-16"]);
  });

  it("concurrent capability submissions both persist (no lost update)", async () => {
    const id = await createTrip(tripInput);
    await Promise.all([
      submitAvailability(id, sameNameActorA, {
        name: "Reed",
        email: "reed@example.com",
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      }),
      submitAvailability(id, sameNameActorB, {
        name: "Morgan",
        email: "morgan@example.com",
        selectedDates: ["2037-01-16"],
        preferences: {},
        conflictCount: 0,
      }),
    ]);
    const trip = await getTrip(id);
    expect(trip!.responses).toHaveLength(2);
  });

  it("submitAvailability to a missing trip throws", async () => {
    await expect(
      submitAvailability("nope", sameNameActorA, {
        name: "X",
        email: "",
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      }),
    ).rejects.toThrow("Trip not found");
  });

  it("confirmTripOnce sets the date", async () => {
    const id = await createTrip(tripInput, organizer);
    const { trip } = await confirmTripOnce(id, organizer, "2037-01-09");
    expect(trip.confirmedDate).toBe("2037-01-09");
    expect((await getTrip(id))!.confirmedDate).toBe("2037-01-09");
  });
});

describe("actor-aware lifecycle services (memory fallback)", () => {
  it("creates opaque 16-byte IDs and does not make legacy creates organizer-owned", async () => {
    const ownedId = await createTrip(tripInput, organizer);
    const legacyId = await createTrip(tripInput);

    expect(ownedId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(legacyId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await listTripsForActor(organizer)).map((trip) => trip.id)).toEqual(
      [ownedId],
    );
    await expect(getManagedTrip(legacyId, organizer)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(createTrip(tripInput, sameNameActorA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("claims a legacy trip once for a matching signed organizer email", async () => {
    const legacyId = await createTrip({
      ...tripInput,
      organizerEmail: "  quinn@EXAMPLE.com ",
    });

    const claimed = await getManagedTrip(legacyId, organizer, {
      claimLegacy: true,
    });

    expect(claimed.organizerEmail).toBe("quinn@example.com");
    await expect(getManagedTrip(legacyId, organizer)).resolves.toMatchObject({
      id: legacyId,
    });
    expect(await listTripsForActor(organizer)).toEqual([
      expect.objectContaining({ id: legacyId, role: "organizer" }),
    ]);
  });

  it("denies wrong-email, capability, and name-only legacy claims", async () => {
    const emailLegacyId = await createTrip(tripInput);
    const capabilityWithEmail: Actor = {
      actorKey: "capability:spoofed-organizer",
      kind: "capability",
      name: "Quinn",
      email: "quinn@example.com",
    };

    await expect(
      getManagedTrip(emailLegacyId, otherAccount, { claimLegacy: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getManagedTrip(emailLegacyId, capabilityWithEmail, { claimLegacy: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const nameOnlyLegacyId = await createTrip({
      ...tripInput,
      organizerEmail: "",
    });
    await expect(
      getManagedTrip(nameOnlyLegacyId, organizer, { claimLegacy: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      getManagedTrip(emailLegacyId, organizer),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("preserves a legacy confirmed trip when its organizer claims it", async () => {
    const legacyId = await createTrip(tripInput);
    // Seed the historical persisted shape without keeping an unauthenticated
    // production mutation helper solely for this fixture.
    const stored = (
      globalThis as unknown as {
        __convergeTrips: Map<string, { trip: Record<string, unknown> }>;
      }
    ).__convergeTrips.get(legacyId)!;
    Object.assign(stored.trip, {
      status: "confirmed",
      confirmedDate: "2037-01-09",
      confirmedAt: "2026-07-11T12:00:00Z",
      confirmationVersion: 1,
    });

    const claimed = await getManagedTrip(legacyId, organizer, {
      claimLegacy: true,
    });

    expect(claimed).toMatchObject({
      status: "confirmed",
      confirmedDate: "2037-01-09",
      confirmationVersion: 1,
    });
  });

  it("allows exactly one actor to win a competing legacy claim", async () => {
    const legacyId = await createTrip(tripInput);
    const sameEmailAccount: Actor = {
      actorKey: "account:same-email-other-provider",
      kind: "account",
      name: "Quinn Alternate",
      email: "quinn@example.com",
    };

    const attempts = await Promise.allSettled([
      getManagedTrip(legacyId, organizer, { claimLegacy: true }),
      getManagedTrip(legacyId, sameEmailAccount, { claimLegacy: true }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
  });

  it("keeps same-name actors separate and preserves public IDs on replacement", async () => {
    const id = await createTrip(tripInput, organizer);
    const first = await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: ["2037-01-09"],
      preferences: { "2037-01-09": "available" },
      conflictCount: 0,
    });
    const second = await submitAvailability(id, sameNameActorB, {
      name: "Alex",
      selectedDates: ["2037-01-16"],
      preferences: { "2037-01-16": "preferred" },
      conflictCount: 0,
    });
    const updated = await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 1,
    });

    expect(first.publicId).toBeTruthy();
    expect(second.publicId).not.toBe(first.publicId);
    expect(updated.publicId).toBe(first.publicId);
    expect(updated.selectedDates).toEqual([]);
    expect((await getManagedTrip(id, organizer)).responses).toHaveLength(2);
  });

  it("stores a submitted email from an anonymous capability actor", async () => {
    const id = await createTrip(tripInput, organizer);
    const saved = await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      email: "Alex@Example.com",
    });

    expect(saved.email).toBe("alex@example.com");
    const viewer = await getViewerState(id, sameNameActorA);
    expect(viewer.response?.email).toBe("alex@example.com");
  });

  it("prefers a signed-in actor's session email over a submitted one", async () => {
    const id = await createTrip(tripInput, organizer);
    const signedRespondent: Actor = {
      actorKey: "account:respondent-email",
      kind: "account",
      name: "Reed",
      email: "reed@example.com",
    };

    const saved = await submitAvailability(id, signedRespondent, {
      name: "Reed",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      email: "attacker@example.com",
    });

    expect(saved.email).toBe("reed@example.com");
  });

  it("exposes the viewer's own submitted email via getViewerState but never in the shared responses list", async () => {
    const id = await createTrip(tripInput, organizer);
    await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      email: "alex@example.com",
    });

    const viewer = await getViewerState(id, sameNameActorA);

    expect(viewer.response?.email).toBe("alex@example.com");
    expect(JSON.stringify(viewer.trip)).not.toContain("example.com");
  });

  it("returns only the requesting actor response in sanitized viewer state", async () => {
    const id = await createTrip(tripInput, organizer);
    const signedRespondent: Actor = {
      actorKey: "account:respondent",
      kind: "account",
      name: "Reed",
      email: "REED@EXAMPLE.COM",
    };
    await submitAvailability(id, signedRespondent, {
      name: "Reed",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
    });

    const respondentState = await getViewerState(id, signedRespondent);
    const publicState = await getViewerState(id, null);
    const organizerState = await getViewerState(id, organizer);

    expect(respondentState.role).toBe("respondent");
    expect(respondentState.response?.selectedDates).toEqual([]);
    expect(publicState.role).toBe("viewer");
    expect(publicState.response).toBeNull();
    expect(organizerState.role).toBe("organizer");
    // The viewer's own response may legitimately carry their own email back
    // to them (for prefill), but the shared trip.responses list, which any
    // viewer of the join link can read, must never carry anyone's email.
    expect(respondentState.response?.email).toBe("reed@example.com");
    expect(JSON.stringify(respondentState.trip)).not.toContain("example.com");
    expect(JSON.stringify(respondentState)).not.toContain("account:");
    expect(respondentState.trip.responses[0].publicId).toBe(
      respondentState.response?.publicId,
    );
  });

  it("rejects candidate violations for availability and confirmation", async () => {
    const id = await createTrip(tripInput, organizer);

    await expect(
      submitAvailability(id, sameNameActorA, {
        name: "Alex",
        selectedDates: ["2037-01-23"],
        preferences: {},
        conflictCount: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      confirmTripOnce(id, organizer, "2037-01-23"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("locks availability after confirmation and makes same-date confirmation idempotent", async () => {
    const id = await createTrip(tripInput, organizer);
    await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: ["2037-01-09"],
      preferences: {},
      conflictCount: 0,
    });

    const first = await confirmTripOnce(id, organizer, "2037-01-09");
    const retry = await confirmTripOnce(id, organizer, "2037-01-09");

    expect(first.alreadyConfirmed).toBe(false);
    expect(first.confirmationVersion).toBe(1);
    expect(first.trip.status).toBe("confirmed");
    expect(retry.alreadyConfirmed).toBe(true);
    expect(retry.confirmationVersion).toBe(1);
    await expect(
      confirmTripOnce(id, organizer, "2037-01-16"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      submitAvailability(id, sameNameActorA, {
        name: "Alex",
        selectedDates: [],
        preferences: {},
        conflictCount: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("enforces organizer authorization and permits a new version after reopen", async () => {
    const id = await createTrip(tripInput, organizer);

    await expect(getManagedTrip(id, otherAccount)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      confirmTripOnce(id, otherAccount, "2037-01-09"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await confirmTripOnce(id, organizer, "2037-01-09");
    await expect(reopenTrip(id, otherAccount)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const reopened = await reopenTrip(id, organizer);
    expect(reopened.status).toBe("collecting");
    expect(reopened.confirmedDate).toBeNull();
    expect(reopened.confirmationVersion).toBe(1);

    await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: ["2037-01-16"],
      preferences: {},
      conflictCount: 0,
    });
    const secondConfirmation = await confirmTripOnce(
      id,
      organizer,
      "2037-01-16",
    );
    expect(secondConfirmation.confirmationVersion).toBe(2);
    expect(secondConfirmation.trip.confirmedDate).toBe("2037-01-16");
  });

  it("serializes competing confirmation dates to one stable winner", async () => {
    const id = await createTrip(tripInput, organizer);

    const attempts = await Promise.allSettled([
      confirmTripOnce(id, organizer, "2037-01-09"),
      confirmTripOnce(id, organizer, "2037-01-16"),
    ]);
    const successes = attempts.filter(
      (
        attempt,
      ): attempt is PromiseFulfilledResult<
        Awaited<ReturnType<typeof confirmTripOnce>>
      > => attempt.status === "fulfilled",
    );
    const failures = attempts.filter(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected",
    );

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBeInstanceOf(ConflictError);
    const stored = await getTrip(id);
    expect(stored).toMatchObject({
      status: "confirmed",
      confirmedDate: successes[0].value.confirmedDate,
      confirmationVersion: 1,
    });
  });

  it("serializes availability and confirmation without a post-confirm write", async () => {
    const availabilityFirstId = await createTrip(tripInput, organizer);
    const availabilityFirst = await Promise.allSettled([
      submitAvailability(availabilityFirstId, sameNameActorA, {
        name: "Alex",
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      }),
      confirmTripOnce(availabilityFirstId, organizer, "2037-01-09"),
    ]);
    expect(
      availabilityFirst.every((result) => result.status === "fulfilled"),
    ).toBe(true);
    expect(await getManagedTrip(availabilityFirstId, organizer)).toMatchObject({
      status: "confirmed",
      confirmationVersion: 1,
      responses: [{ name: "Alex" }],
    });

    const confirmationFirstId = await createTrip(tripInput, organizer);
    const confirmationFirst = await Promise.allSettled([
      confirmTripOnce(confirmationFirstId, organizer, "2037-01-09"),
      submitAvailability(confirmationFirstId, sameNameActorA, {
        name: "Alex",
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      }),
    ]);
    expect(confirmationFirst[0].status).toBe("fulfilled");
    expect(confirmationFirst[1].status).toBe("rejected");
    if (confirmationFirst[1].status === "rejected") {
      expect(confirmationFirst[1].reason).toBeInstanceOf(ConflictError);
    }
    expect(await getManagedTrip(confirmationFirstId, organizer)).toMatchObject({
      status: "confirmed",
      confirmationVersion: 1,
      responses: [],
    });
  });

  it("claims confirmation deliveries once and retries only failed work", async () => {
    const id = await createTrip(tripInput, organizer);
    const respondentA: Actor = {
      actorKey: "account:delivery-a",
      kind: "account",
      email: "a@example.com",
    };
    const respondentB: Actor = {
      actorKey: "account:delivery-b",
      kind: "account",
      email: "b@example.com",
    };
    for (const [actor, name] of [
      [respondentA, "A"],
      [respondentB, "B"],
    ] as const) {
      await submitAvailability(id, actor, {
        name,
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      });
    }
    await confirmTripOnce(id, organizer, "2037-01-09");

    const competingClaims = await Promise.all([
      claimConfirmationDeliveries(id, organizer, 1),
      claimConfirmationDeliveries(id, organizer, 1),
    ]);
    expect(competingClaims.map((claim) => claim.length).sort()).toEqual([0, 2]);
    const claimed = competingClaims.find((claim) => claim.length > 0)!;

    await completeConfirmationDelivery(
      id,
      organizer,
      1,
      claimed[0].responsePublicId,
      true,
    );
    await completeConfirmationDelivery(
      id,
      organizer,
      1,
      claimed[1].responsePublicId,
      false,
    );

    const retry = await claimConfirmationDeliveries(id, organizer, 1);
    expect(retry).toEqual([claimed[1]]);
    await completeConfirmationDelivery(
      id,
      organizer,
      1,
      retry[0].responsePublicId,
      true,
    );
    expect(await claimConfirmationDeliveries(id, organizer, 1)).toEqual([]);
    await expect(
      claimConfirmationDeliveries(id, otherAccount, 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows existing actor updates at capacity but rejects a new actor", async () => {
    const id = await createTrip(tripInput, organizer);
    for (let index = 0; index < 100; index++) {
      await submitAvailability(
        id,
        {
          actorKey: `capability:${index}`,
          kind: "capability",
        },
        {
          name: `Person ${index}`,
          selectedDates: [],
          preferences: {},
          conflictCount: 0,
        },
      );
    }

    const existing = await submitAvailability(
      id,
      {
        actorKey: "capability:0",
        kind: "capability",
      },
      {
        name: "Updated",
        selectedDates: ["2037-01-09"],
        preferences: {},
        conflictCount: 0,
      },
    );
    expect(existing.name).toBe("Updated");
    await expect(
      submitAvailability(
        id,
        {
          actorKey: "capability:100",
          kind: "capability",
        },
        {
          name: "Overflow",
          selectedDates: [],
          preferences: {},
          conflictCount: 0,
        },
      ),
    ).rejects.toBeInstanceOf(CapacityError);
  });

  it("lists organizer and respondent trips once with sanitized normalized summaries", async () => {
    const ownedId = await createTrip({ ...tripInput, duration: 2 }, organizer);
    const responseOnlyId = await createTrip(
      { ...tripInput, duration: 2 },
      otherAccount,
    );
    await expect(submitAvailability(ownedId, organizer, {
      name: "Quinn",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
    })).rejects.toBeInstanceOf(ForbiddenError);
    await submitAvailability(responseOnlyId, organizer, {
      name: "Quinn",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
    });

    const summaries = await listTripsForActor(organizer);

    expect(summaries).toHaveLength(2);
    expect(summaries.find((trip) => trip.id === ownedId)).toMatchObject({
      role: "organizer",
      duration: 3,
      status: "collecting",
      confirmationVersion: 0,
    });
    expect(summaries.find((trip) => trip.id === responseOnlyId)?.role).toBe(
      "respondent",
    );
    expect(JSON.stringify(summaries)).not.toContain("example.com");
    expect(JSON.stringify(summaries)).not.toContain("account:");
  });

  it("normalizes legacy weekend duration on every trip-returning service", async () => {
    const id = await createTrip({ ...tripInput, duration: 2 }, organizer);

    expect((await getTrip(id))?.duration).toBe(3);
    expect((await getViewerState(id, null)).trip.duration).toBe(3);
    expect((await getManagedTrip(id, organizer)).duration).toBe(3);
    expect(
      (await confirmTripOnce(id, organizer, "2037-01-09")).trip.duration,
    ).toBe(3);
    expect((await reopenTrip(id, organizer)).duration).toBe(3);
  });
});

describe("actor-aware lifecycle services (Supabase RPC contract)", () => {
  const actor: Actor = {
    actorKey: "account:respondent",
    kind: "account",
    email: "RESPONDENT@EXAMPLE.COM",
  };
  const input = {
    name: "Respondent",
    selectedDates: [],
    preferences: {},
    conflictCount: 0,
  };

  function tripRow(
    status: "collecting" | "confirmed",
    confirmedDate: string | null,
    confirmationVersion: number,
    organizerActorKey: string | null = organizer.actorKey,
    organizerEmailNormalized = "quinn@example.com",
  ) {
    return {
      id: "trip-1",
      data: {
        ...tripInput,
        id: "trip-1",
        responses: [],
        status,
        confirmedDate,
        confirmedAt: confirmedDate ? "2026-07-23T12:00:00.000Z" : null,
        confirmationVersion,
        createdAt: "2026-07-23T11:00:00.000Z",
      },
      status,
      organizer_actor_key: organizerActorKey,
      organizer_email_normalized: organizerEmailNormalized,
      confirmed_date: confirmedDate,
      confirmed_at: confirmedDate ? "2026-07-23T12:00:00.000Z" : null,
      confirmation_version: confirmationVersion,
      created_at: "2026-07-23T11:00:00.000Z",
    };
  }

  it("claims legacy ownership with one conditional Supabase update", async () => {
    const legacyRow = tripRow("collecting", null, 0, null);
    const tripReadQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    tripReadQuery.select = vi.fn(() => tripReadQuery);
    tripReadQuery.eq = vi.fn(() => tripReadQuery);
    tripReadQuery.maybeSingle = vi.fn().mockResolvedValue({
      data: legacyRow,
      error: null,
    });

    const responseQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    responseQuery.select = vi.fn(() => responseQuery);
    responseQuery.eq = vi.fn().mockResolvedValue({ data: [], error: null });

    const claimQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    claimQuery.update = vi.fn(() => claimQuery);
    claimQuery.eq = vi.fn(() => claimQuery);
    claimQuery.is = vi.fn(() => claimQuery);
    claimQuery.select = vi.fn(() => claimQuery);
    claimQuery.maybeSingle = vi.fn().mockResolvedValue({
      data: { organizer_actor_key: organizer.actorKey },
      error: null,
    });

    let tripsQueryCount = 0;
    const from = vi.fn((table: string) => {
      if (table === "trip_responses") return responseQuery;
      tripsQueryCount++;
      return tripsQueryCount === 1 ? tripReadQuery : claimQuery;
    });
    getSupabaseServiceClientMock.mockReturnValue({ from });

    const claimed = await getManagedTrip("trip-1", organizer, {
      claimLegacy: true,
    });

    expect(claimed.id).toBe("trip-1");
    expect(claimQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        organizer_actor_key: organizer.actorKey,
      }),
    );
    expect(claimQuery.eq.mock.calls).toContainEqual(["id", "trip-1"]);
    expect(claimQuery.is).toHaveBeenCalledWith("organizer_actor_key", null);
    expect(claimQuery.eq.mock.calls).toContainEqual([
      "organizer_email_normalized",
      "quinn@example.com",
    ]);
    expect(claimQuery.select).toHaveBeenCalledWith("organizer_actor_key");
  });

  function lifecycleClient(
    rpcResult: { result_code: string; confirmation_version: number | null },
    loadedTrip: ReturnType<typeof tripRow>,
  ) {
    const tripQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    tripQuery.select = vi.fn(() => tripQuery);
    tripQuery.eq = vi.fn(() => tripQuery);
    tripQuery.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: loadedTrip, error: null });

    const responseQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    responseQuery.select = vi.fn(() => responseQuery);
    responseQuery.eq = vi.fn().mockResolvedValue({ data: [], error: null });

    return {
      rpc: vi.fn().mockResolvedValue({ data: [rpcResult], error: null }),
      from: vi.fn((table: string) =>
        table === "trips" ? tripQuery : responseQuery,
      ),
    };
  }

  it("accepts an exact single-row submit result and normalizes actor email", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          result_code: "created",
          response_public_id: "7d60afe3-fc9c-4b89-bcac-bd233b4164dd",
        },
      ],
      error: null,
    });
    getSupabaseServiceClientMock.mockReturnValue({ rpc });

    const response = await submitAvailability("trip-1", actor, input);

    expect(response.publicId).toBe("7d60afe3-fc9c-4b89-bcac-bd233b4164dd");
    expect(response.email).toBe("respondent@example.com");
    expect(rpc).toHaveBeenCalledWith(
      "submit_trip_response",
      expect.objectContaining({
        p_trip_id: "trip-1",
        p_actor_key: actor.actorKey,
        p_data: expect.objectContaining({ email: "respondent@example.com" }),
      }),
    );
  });

  it("fails closed for malformed or non-single-row RPC responses", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            result_code: "created",
            response_public_id: "7d60afe3-fc9c-4b89-bcac-bd233b4164dd",
            unexpected: true,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ result_code: "created", response_public_id: "not-a-uuid" }],
        error: null,
      });
    getSupabaseServiceClientMock.mockReturnValue({ rpc });

    await expect(submitAvailability("trip-1", actor, input)).rejects.toThrow(
      "invalid response",
    );
    await expect(submitAvailability("trip-1", actor, input)).rejects.toThrow(
      "invalid response",
    );
    await expect(submitAvailability("trip-1", actor, input)).rejects.toThrow(
      "invalid response",
    );
  });

  it("maps stable submit result codes to typed domain errors", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ result_code: "trip_confirmed", response_public_id: null }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ result_code: "capacity_reached", response_public_id: null }],
        error: null,
      });
    getSupabaseServiceClientMock.mockReturnValue({ rpc });

    await expect(
      submitAvailability("trip-1", actor, input),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      submitAvailability("trip-1", actor, input),
    ).rejects.toBeInstanceOf(CapacityError);
  });

  it("rejects an invalid lifecycle version before mapping its result code", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ result_code: "conflict", confirmation_version: -1 }],
      error: null,
    });
    getSupabaseServiceClientMock.mockReturnValue({ rpc });

    await expect(
      confirmTripOnce("trip-1", organizer, "2037-01-09"),
    ).rejects.toThrow("invalid response");
  });

  it("returns exact confirmed and reopened snapshots after successful RPCs", async () => {
    getSupabaseServiceClientMock.mockReturnValue(
      lifecycleClient(
        { result_code: "confirmed", confirmation_version: 1 },
        tripRow("confirmed", "2037-01-09", 1),
      ),
    );
    const confirmed = await confirmTripOnce("trip-1", organizer, "2037-01-09");
    expect(confirmed).toMatchObject({
      confirmedDate: "2037-01-09",
      confirmationVersion: 1,
      trip: {
        status: "confirmed",
        confirmedDate: "2037-01-09",
        confirmationVersion: 1,
      },
    });

    getSupabaseServiceClientMock.mockReturnValue(
      lifecycleClient(
        { result_code: "reopened", confirmation_version: 1 },
        tripRow("collecting", null, 1),
      ),
    );
    const reopened = await reopenTrip("trip-1", organizer);
    expect(reopened).toMatchObject({
      status: "collecting",
      confirmedDate: null,
      confirmationVersion: 1,
    });
  });

  it("rejects a null reopen version as an invalid RPC response", async () => {
    getSupabaseServiceClientMock.mockReturnValue(
      lifecycleClient(
        { result_code: "reopened", confirmation_version: null },
        tripRow("collecting", null, 1),
      ),
    );

    await expect(reopenTrip("trip-1", organizer)).rejects.toThrow(
      "invalid response",
    );
  });

  it("throws superseded when a confirm read observes a newer version", async () => {
    getSupabaseServiceClientMock.mockReturnValue(
      lifecycleClient(
        { result_code: "confirmed", confirmation_version: 1 },
        tripRow("confirmed", "2037-01-09", 2),
      ),
    );

    await expect(
      confirmTripOnce("trip-1", organizer, "2037-01-09"),
    ).rejects.toMatchObject({
      name: "ConflictError",
      code: "superseded",
    });
  });

  it("throws superseded when a reopen read observes mismatched status or version", async () => {
    getSupabaseServiceClientMock.mockReturnValueOnce(
      lifecycleClient(
        { result_code: "reopened", confirmation_version: 1 },
        tripRow("confirmed", "2037-01-09", 1),
      ),
    );
    await expect(reopenTrip("trip-1", organizer)).rejects.toMatchObject({
      name: "ConflictError",
      code: "superseded",
    });

    getSupabaseServiceClientMock.mockReturnValueOnce(
      lifecycleClient(
        { result_code: "reopened", confirmation_version: 1 },
        tripRow("collecting", null, 2),
      ),
    );
    await expect(reopenTrip("trip-1", organizer)).rejects.toMatchObject({
      name: "ConflictError",
      code: "superseded",
    });
  });

  it("claims and completes exact confirmation delivery RPC rows", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            result_code: "claimed",
            response_public_id: "7d60afe3-fc9c-4b89-bcac-bd233b4164dd",
            to_email: "recipient@example.com",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ result_code: "completed" }],
        error: null,
      });
    getSupabaseServiceClientMock.mockReturnValue({ rpc });

    expect(await claimConfirmationDeliveries("trip-1", organizer, 2)).toEqual([
      {
        responsePublicId: "7d60afe3-fc9c-4b89-bcac-bd233b4164dd",
        toEmail: "recipient@example.com",
      },
    ]);
    await completeConfirmationDelivery(
      "trip-1",
      organizer,
      2,
      "7d60afe3-fc9c-4b89-bcac-bd233b4164dd",
      true,
    );

    expect(rpc.mock.calls).toEqual([
      [
        "claim_confirmation_deliveries",
        {
          p_trip_id: "trip-1",
          p_actor_key: organizer.actorKey,
          p_confirmation_version: 2,
        },
      ],
      [
        "complete_confirmation_delivery",
        {
          p_trip_id: "trip-1",
          p_actor_key: organizer.actorKey,
          p_confirmation_version: 2,
          p_response_public_id: "7d60afe3-fc9c-4b89-bcac-bd233b4164dd",
          p_succeeded: true,
        },
      ],
    ]);
  });

  it("fails closed for malformed delivery RPC rows and maps authorization", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { result_code: "claimed", response_public_id: null, to_email: null },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            result_code: "forbidden",
            response_public_id: null,
            to_email: null,
          },
        ],
        error: null,
      });
    getSupabaseServiceClientMock.mockReturnValue({ rpc });

    await expect(
      claimConfirmationDeliveries("trip-1", organizer, 1),
    ).rejects.toThrow("invalid response");
    await expect(
      claimConfirmationDeliveries("trip-1", organizer, 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("toPublicTrip", () => {
  it("strips organizer and respondent emails", async () => {
    const id = await createTrip(tripInput);
    await submitAvailability(id, sameNameActorA, {
      name: "Reed",
      email: "reed@example.com",
      selectedDates: ["2037-01-09"],
      preferences: {},
      conflictCount: 0,
    });
    const pub = toPublicTrip((await getTrip(id))!);
    expect(JSON.stringify(pub)).not.toContain("example.com");
    expect(pub.organizerName).toBe("Quinn");
    expect(pub.responses[0].name).toBe("Reed");
    expect(pub.responses[0]).not.toHaveProperty("email");
  });

  it("strips an anonymously-submitted respondent email too", async () => {
    const id = await createTrip(tripInput, organizer);
    await submitAvailability(id, sameNameActorA, {
      name: "Alex",
      selectedDates: [],
      preferences: {},
      conflictCount: 0,
      email: "alex@example.com",
    });

    const pub = toPublicTrip((await getTrip(id))!);

    expect(JSON.stringify(pub)).not.toContain("example.com");
    expect(pub.responses[0]).not.toHaveProperty("email");
  });

  it("normalizes legacy weekend trips from 2 to 3 days", async () => {
    const id = await createTrip({ ...tripInput, duration: 2 });
    const pub = toPublicTrip((await getTrip(id))!);
    expect(pub.duration).toBe(3);
  });

  it("leaves non-weekend durations alone", async () => {
    const id = await createTrip({
      ...tripInput,
      duration: 5,
      durationPreset: "custom",
    });
    const pub = toPublicTrip((await getTrip(id))!);
    expect(pub.duration).toBe(5);
  });
});
