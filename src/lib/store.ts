import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getStorage } from "@/lib/storage";
import { runtimeConfig } from "./runtime/config";
import type { AvailabilityInput, DatePreference } from "@/lib/trip-validation";
import { versionedAnswers, type VersionedAnswers } from "./availability";
import {
  emptyPlanning,
  parsePlanning,
  parseTripTiming,
  type PlanningSettings,
  type TripTimeFields,
} from "./trip-planning";

export type { AvailabilityInput } from "@/lib/trip-validation";

export type TripStatus = "collecting" | "confirmed";
export type ViewerRole = "organizer" | "respondent" | "viewer";

export interface Actor {
  actorKey: string;
  kind: "account" | "capability";
  name?: string;
  email?: string;
}

export interface TripResponse extends VersionedAnswers {
  publicId: string;
  name: string;
  email: string;
  selectedDates: string[];
  preferences: Record<string, DatePreference>;
  conflictCount: number;
  submittedAt: string;
}

export interface Trip extends TripTimeFields {
  calendarNamespace?: string;
  planning?: PlanningSettings;
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;
  durationPreset: string;
  notes: string;
  organizerName: string;
  organizerEmail: string;
  selectedDates: string[];
  responses: TripResponse[];
  status: TripStatus;
  confirmedDate: string | null;
  confirmedAt: string | null;
  confirmationVersion: number;
  createdAt: string;
}

export interface PublicTripResponse extends VersionedAnswers {
  publicId: string;
  name: string;
  selectedDates: string[];
  preferences: Record<string, DatePreference>;
  conflictCount: number;
  submittedAt: string;
}

// The viewer's own response, as returned by getViewerState/`/me`. Unlike
// PublicTripResponse (used for the group's shared `trip.responses` list,
// which anyone holding the join link can read), this is scoped to the
// requesting actor's own capability or session, so it is safe to include
// their own email back to them for prefill. It must never be used to build
// the shared responses list.
export interface OwnTripResponse extends PublicTripResponse {
  email?: string;
}

export interface PublicTrip extends TripTimeFields {
  calendarNamespace?: string;
  invitationsClosed?: boolean;
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;
  durationPreset: string;
  notes: string;
  organizerName: string;
  selectedDates: string[];
  responses: PublicTripResponse[];
  status: TripStatus;
  confirmedDate: string | null;
  confirmedAt: string | null;
  confirmationVersion: number;
  createdAt: string;
}

export interface ViewerState {
  trip: PublicTrip;
  role: ViewerRole;
  response: OwnTripResponse | null;
}

export type ManagedTrip = Trip & { notifications?: NotificationSummary };

export interface ConfirmResult {
  trip: Trip;
  confirmedDate: string;
  confirmationVersion: number;
  alreadyConfirmed: boolean;
}

export interface ConfirmationDelivery {
  responsePublicId: string;
  toEmail: string;
}

export interface TripSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;
  durationPreset: string;
  status: TripStatus;
  confirmedDate: string | null;
  confirmationVersion: number;
  createdAt: string;
  role: "organizer" | "respondent";
}

export interface CreateTripData extends TripTimeFields {
  name: string;
  startDate: string;
  endDate: string;
  duration: number;
  durationPreset: string;
  notes: string;
  selectedDates: string[];
  organizerName?: string;
  organizerEmail?: string;
}

export class NotFoundError extends Error {
  constructor(message = "Trip not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  readonly code: string;

  constructor(code = "conflict", message = "Trip state conflict") {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

export class CapacityError extends Error {
  constructor(message = "Trip response capacity reached") {
    super(message);
    this.name = "CapacityError";
  }
}

interface StoredTrip {
  trip: Trip;
  organizerActorKey: string | null;
  organizerEmailNormalized: string | null;
}

interface StoredResponse {
  actorKey: string;
  response: TripResponse;
}

type DeliveryStatus = "pending" | "sending" | "sent" | "failed";

interface StoredDelivery extends ConfirmationDelivery {
  status: DeliveryStatus;
  attemptCount: number;
  updatedAt: number;
  leaseToken?: string;
  leaseExpiresAt?: number;
  nextAttemptAt?: number;
}

interface LoadedTrip {
  trip: Trip;
  organizerActorKey: string | null;
  organizerEmailNormalized: string | null;
  responsesByActor: Map<string, TripResponse>;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function getSupabase() {
  const storage = getStorage();
  if (!storage && process.env.NODE_ENV !== 'test') throw new Error('Durable storage is required');
  return storage;
}

const g = globalThis as unknown as {
  __convergeTrips?: Map<string, StoredTrip>;
  __convergeResponses?: Map<string, Map<string, StoredResponse>>;
  __convergeTripMutexes?: Map<string, Promise<void>>;
  __convergeDeliveries?: Map<string, Map<string, StoredDelivery>>;
};
const memoryTrips: Map<string, StoredTrip> =
  g.__convergeTrips ?? (g.__convergeTrips = new Map<string, StoredTrip>());
const memoryResponses: Map<
  string,
  Map<string, StoredResponse>
> = g.__convergeResponses ??
(g.__convergeResponses = new Map<string, Map<string, StoredResponse>>());
const memoryTripMutexes: Map<string, Promise<void>> = g.__convergeTripMutexes ??
(g.__convergeTripMutexes = new Map<string, Promise<void>>());
const memoryDeliveries: Map<
  string,
  Map<string, StoredDelivery>
> = g.__convergeDeliveries ??
(g.__convergeDeliveries = new Map<string, Map<string, StoredDelivery>>());

export function __resetMemoryStore(): void {
  memoryTrips.clear();
  memoryResponses.clear();
  memoryTripMutexes.clear();
  memoryDeliveries.clear();
}

async function withTripMutex<T>(
  tripId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = memoryTripMutexes.get(tripId) || Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  memoryTripMutexes.set(tripId, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (memoryTripMutexes.get(tripId) === current) {
      memoryTripMutexes.delete(tripId);
    }
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deliveryKey(tripId: string, confirmationVersion: number): string {
  return `${tripId}\0${confirmationVersion}`;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function generateId(): string {
  return randomBytes(16).toString("base64url");
}

function legacyPublicId(
  tripId: string,
  response: UnknownRecord,
  index: number,
): string {
  return `legacy-${createHash("sha256")
    .update(
      `${tripId}\0${String(response.email || "")}\0${String(response.name || "")}\0${index}`,
    )
    .digest("base64url")
    .slice(0, 22)}`;
}

function normalizeResponse(
  value: unknown,
  fallbackPublicId: string,
  fallbackSubmittedAt: string,
): TripResponse {
  const response = isRecord(value) ? value : {};
  const rawPreferences = isRecord(response.preferences)
    ? response.preferences
    : {};
  const preferences: Record<string, DatePreference> = {};
  for (const [date, preference] of Object.entries(rawPreferences)) {
    if (preference === "available" || preference === "preferred") {
      preferences[date] = preference;
    }
  }

  return {
    ...versionedAnswers(response as VersionedAnswers),
    publicId:
      typeof response.publicId === "string" && response.publicId
        ? response.publicId
        : fallbackPublicId,
    name: typeof response.name === "string" ? response.name : "",
    email: normalizeEmail(response.email),
    selectedDates: Array.isArray(response.selectedDates)
      ? response.selectedDates.filter(
          (date): date is string => typeof date === "string",
        )
      : [],
    preferences,
    conflictCount: Number.isInteger(response.conflictCount)
      ? Number(response.conflictCount)
      : 0,
    submittedAt:
      typeof response.submittedAt === "string" && response.submittedAt
        ? response.submittedAt
        : fallbackSubmittedAt,
  };
}

function normalizeTrip(trip: Trip): Trip {
  return {
    ...trip,
    duration:
      trip.durationPreset === "weekend" && trip.duration === 2
        ? 3
        : trip.duration,
    responses: trip.responses.map((response) => ({ ...response })),
  };
}

function tripFromRow(value: unknown): StoredTrip {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Storage returned invalid trip data");
  }
  const data = value.data;
  const id =
    typeof value.id === "string"
      ? value.id
      : typeof data.id === "string"
        ? data.id
        : "";
  if (!id) throw new Error("Storage returned invalid trip data");

  const confirmedDate =
    typeof value.confirmed_date === "string"
      ? value.confirmed_date
      : typeof data.confirmedDate === "string"
        ? data.confirmedDate
        : null;
  const status: TripStatus =
    value.status === "confirmed" || value.status === "collecting"
      ? value.status
      : confirmedDate
        ? "confirmed"
        : "collecting";
  const createdAt =
    typeof data.createdAt === "string"
      ? data.createdAt
      : typeof value.created_at === "string"
        ? value.created_at
        : new Date(0).toISOString();
  const rawResponses = Array.isArray(data.responses) ? data.responses : [];
  const responses = rawResponses.map((response, index) =>
    normalizeResponse(
      response,
      legacyPublicId(id, isRecord(response) ? response : {}, index),
      createdAt,
    ),
  );
  const trip: Trip = {
    calendarNamespace: typeof data.calendarNamespace === "string" && /^[a-z0-9.-]+$/i.test(data.calendarNamespace) ? data.calendarNamespace : "converge-planner.invalid",
    id,
    name: typeof data.name === "string" ? data.name : "",
    startDate: typeof data.startDate === "string" ? data.startDate : "",
    endDate: typeof data.endDate === "string" ? data.endDate : "",
    duration: typeof data.duration === "number" ? data.duration : 1,
    durationPreset:
      typeof data.durationPreset === "string" ? data.durationPreset : "custom",
    notes: typeof data.notes === "string" ? data.notes : "",
    organizerName:
      typeof data.organizerName === "string" ? data.organizerName : "",
    organizerEmail: normalizeEmail(
      data.organizerEmail || value.organizer_email_normalized,
    ),
    selectedDates: Array.isArray(data.selectedDates)
      ? data.selectedDates.filter(
          (date): date is string => typeof date === "string",
        )
      : [],
    responses,
    status,
    confirmedDate,
    confirmedAt:
      typeof value.confirmed_at === "string"
        ? value.confirmed_at
        : typeof data.confirmedAt === "string"
          ? data.confirmedAt
          : null,
    confirmationVersion: Number.isInteger(value.confirmation_version)
      ? Number(value.confirmation_version)
      : Number.isInteger(data.confirmationVersion)
        ? Number(data.confirmationVersion)
        : confirmedDate
          ? 1
          : 0,
    createdAt,
    ...parseTripTiming(
      data,
      [],
      typeof data.duration === "number" ? data.duration : 1,
    ),
    planning: data.planning ? parsePlanning(data.planning) : emptyPlanning(),
  };

  return {
    trip: normalizeTrip(trip),
    organizerActorKey:
      typeof value.organizer_actor_key === "string"
        ? value.organizer_actor_key
        : null,
    organizerEmailNormalized:
      normalizeEmail(value.organizer_email_normalized) || null,
  };
}

function responseFromRow(
  tripId: string,
  value: unknown,
  index: number,
): StoredResponse {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Storage returned invalid response data");
  }
  const actorKey = typeof value.person_key === "string" ? value.person_key : "";
  if (!actorKey) throw new Error("Storage returned invalid response data");
  const submittedAt =
    typeof value.submitted_at === "string"
      ? value.submitted_at
      : new Date(0).toISOString();
  const publicId =
    typeof value.public_id === "string" && value.public_id
      ? value.public_id
      : legacyPublicId(tripId, value.data, index);
  return {
    actorKey,
    response: normalizeResponse(value.data, publicId, submittedAt),
  };
}

function mergeTripResponses(
  trip: Trip,
  storedResponses: Iterable<TripResponse>,
): Trip {
  const responses = new Map<string, TripResponse>();
  for (const response of trip.responses)
    responses.set(response.publicId, response);
  for (const response of Array.from(storedResponses))
    responses.set(response.publicId, response);
  return normalizeTrip({ ...trip, responses: Array.from(responses.values()) });
}

const TRIP_COLUMNS = [
  "id",
  "data",
  "status",
  "organizer_actor_key",
  "organizer_email_normalized",
  "confirmed_date",
  "confirmed_at",
  "confirmation_version",
  "created_at",
].join(",");
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadTrip(tripId: string): Promise<LoadedTrip | null> {
  const sb = getSupabase();
  if (sb) {
    const { data: row, error } = await sb
      .tripRow(tripId);
    if (error) throw new Error("Storage read failed");
    if (!row) return null;

    const storedTrip = tripFromRow(row);
    const { data: responseRows, error: responseError } = await sb
      .responseRows(tripId);
    if (responseError) throw new Error("Storage read failed");

    const responsesByActor = new Map<string, TripResponse>();
    (responseRows || []).forEach((responseRow, index) => {
      const stored = responseFromRow(tripId, responseRow, index);
      responsesByActor.set(stored.actorKey, stored.response);
    });
    return {
      trip: mergeTripResponses(storedTrip.trip, responsesByActor.values()),
      organizerActorKey: storedTrip.organizerActorKey,
      organizerEmailNormalized: storedTrip.organizerEmailNormalized,
      responsesByActor,
    };
  }

  const storedTrip = memoryTrips.get(tripId);
  if (!storedTrip) return null;
  const storedResponses =
    memoryResponses.get(tripId) || new Map<string, StoredResponse>();
  const responsesByActor = new Map<string, TripResponse>();
  storedResponses.forEach((stored, actorKey) => {
    responsesByActor.set(actorKey, stored.response);
  });
  return {
    trip: mergeTripResponses(storedTrip.trip, responsesByActor.values()),
    organizerActorKey: storedTrip.organizerActorKey,
    organizerEmailNormalized: storedTrip.organizerEmailNormalized,
    responsesByActor,
  };
}

function publicResponse(response: TripResponse): PublicTripResponse {
  return {
    ...versionedAnswers(response),
    publicId: response.publicId,
    name: response.name,
    selectedDates: response.selectedDates,
    preferences: response.preferences,
    conflictCount: response.conflictCount,
    submittedAt: response.submittedAt,
  };
}

function ownTripResponse(response: TripResponse): OwnTripResponse {
  const own: OwnTripResponse = publicResponse(response);
  if (response.email) own.email = response.email;
  return own;
}

export function toPublicTrip(trip: Trip): PublicTrip {
  const normalized = normalizeTrip(trip);
  return {
    calendarNamespace: normalized.calendarNamespace || "converge-planner.invalid",
    id: normalized.id,
    name: normalized.name,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    duration: normalized.duration,
    durationPreset: normalized.durationPreset,
    notes: normalized.notes,
    organizerName: normalized.organizerName,
    ...(normalized.timeZone ? { timeZone: normalized.timeZone } : {}),
    ...(normalized.departureTime
      ? { departureTime: normalized.departureTime }
      : {}),
    ...(normalized.returnTime ? { returnTime: normalized.returnTime } : {}),
    invitationsClosed: normalized.planning?.invitationsClosed || false,
    selectedDates: normalized.selectedDates,
    responses: normalized.responses.map(publicResponse),
    status: normalized.status,
    confirmedDate: normalized.confirmedDate,
    confirmedAt: normalized.confirmedAt,
    confirmationVersion: normalized.confirmationVersion,
    createdAt: normalized.createdAt,
  };
}

function tripSummary(
  trip: Trip,
  role: "organizer" | "respondent",
): TripSummary {
  const normalized = normalizeTrip(trip);
  return {
    id: normalized.id,
    name: normalized.name,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    duration: normalized.duration,
    durationPreset: normalized.durationPreset,
    status: normalized.status,
    confirmedDate: normalized.confirmedDate,
    confirmationVersion: normalized.confirmationVersion,
    createdAt: normalized.createdAt,
    role,
  };
}

function assertOrganizer(loaded: LoadedTrip, actor: Actor): void {
  if (loaded.organizerActorKey !== actor.actorKey) throw new ForbiddenError();
}

function assertCandidateDates(trip: Trip, selectedDates: string[]): void {
  const candidates = new Set(trip.selectedDates);
  if (selectedDates.some((date) => !candidates.has(date))) {
    throw new ConflictError(
      "date_not_proposed",
      "Date was not proposed by the organizer",
    );
  }
}

function exactRpcRow(value: unknown, expectedKeys: string[]): UnknownRecord {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("Storage RPC returned an invalid response");
  }
  const actualKeys = Object.keys(value[0]).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error("Storage RPC returned an invalid response");
  }
  return value[0];
}

function parseSubmitRpc(value: unknown): {
  resultCode: string;
  responsePublicId: string | null;
} {
  const row = exactRpcRow(value, ["result_code", "response_public_id"]);
  if (
    typeof row.result_code !== "string" ||
    (row.response_public_id !== null &&
      (typeof row.response_public_id !== "string" ||
        !UUID_RE.test(row.response_public_id)))
  ) {
    throw new Error("Storage RPC returned an invalid response");
  }
  return {
    resultCode: row.result_code,
    responsePublicId: row.response_public_id,
  };
}

function parseLifecycleRpc(value: unknown): {
  resultCode: string;
  confirmationVersion: number | null;
} {
  const row = exactRpcRow(value, ["result_code", "confirmation_version"]);
  if (
    typeof row.result_code !== "string" ||
    (row.confirmation_version !== null &&
      (!Number.isInteger(row.confirmation_version) ||
        Number(row.confirmation_version) < 0))
  ) {
    throw new Error("Storage RPC returned an invalid response");
  }
  return {
    resultCode: row.result_code,
    confirmationVersion:
      row.confirmation_version === null
        ? null
        : Number(row.confirmation_version),
  };
}

function parseClaimDeliveriesRpc(value: unknown): {
  resultCode: string;
  deliveries: ConfirmationDelivery[];
} {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error("Storage RPC returned an invalid response");
  }
  const rows = value.map((row) =>
    exactRpcRow([row], ["result_code", "response_public_id", "to_email"]),
  );
  const firstCode = rows[0].result_code;
  if (typeof firstCode !== "string") {
    throw new Error("Storage RPC returned an invalid response");
  }
  if (firstCode !== "claimed") {
    if (
      rows.length !== 1 ||
      rows[0].response_public_id !== null ||
      rows[0].to_email !== null
    ) {
      throw new Error("Storage RPC returned an invalid response");
    }
    return { resultCode: firstCode, deliveries: [] };
  }

  const deliveries = rows.map((row) => {
    if (
      row.result_code !== "claimed" ||
      typeof row.response_public_id !== "string" ||
      !UUID_RE.test(row.response_public_id) ||
      typeof row.to_email !== "string" ||
      !row.to_email ||
      row.to_email.length > 320
    ) {
      throw new Error("Storage RPC returned an invalid response");
    }
    return {
      responsePublicId: row.response_public_id,
      toEmail: row.to_email,
    };
  });
  return { resultCode: "claimed", deliveries };
}

function parseCompletionRpc(value: unknown): string {
  const row = exactRpcRow(value, ["result_code"]);
  if (typeof row.result_code !== "string") {
    throw new Error("Storage RPC returned an invalid response");
  }
  return row.result_code;
}

function mapSubmitFailure(resultCode: string): never {
  if (resultCode === "not_found") throw new NotFoundError();
  if (resultCode === "capacity_reached") throw new CapacityError();
  if (
    resultCode === "trip_confirmed" ||
    resultCode === "date_not_proposed" ||
    resultCode === "invalid_argument"
  ) {
    throw new ConflictError(resultCode);
  }
  throw new Error("Storage RPC returned an invalid response");
}

function mapLifecycleFailure(resultCode: string): never {
  if (resultCode === "not_found") throw new NotFoundError();
  if (resultCode === "forbidden") throw new ForbiddenError();
  if (
    resultCode === "conflict" ||
    resultCode === "invalid_candidate" ||
    resultCode === "invalid_argument"
  ) {
    throw new ConflictError(resultCode);
  }
  throw new Error("Storage RPC returned an invalid response");
}

export async function getTrip(tripId: string): Promise<Trip | null> {
  const loaded = await loadTrip(tripId);
  return loaded ? normalizeTrip(loaded.trip) : null;
}

export async function createTrip(
  data: CreateTripData,
  organizer?: Actor,
): Promise<string> {
  if (organizer?.kind === "capability") {
    throw new ForbiddenError("Organizers must use an account actor");
  }
  const sb = getSupabase();
  const id = generateId();
  const createdAt = new Date().toISOString();
  const organizerEmail = organizer
    ? normalizeEmail(organizer.email)
    : normalizeEmail(data.organizerEmail);
  const trip: Trip = {
    ...parseTripTiming(data, data.selectedDates, data.duration),
    planning: emptyPlanning(),
    calendarNamespace: process.env.NODE_ENV === "test" && !process.env.CONVERGE_MODE ? "converge-planner.invalid" : runtimeConfig().namespace,
    id,
    name: data.name,
    startDate: data.startDate,
    endDate: data.endDate,
    duration: data.duration,
    durationPreset: data.durationPreset,
    notes: data.notes,
    organizerName: organizer?.name || data.organizerName || "",
    organizerEmail,
    selectedDates: [...data.selectedDates],
    responses: [],
    status: "collecting",
    confirmedDate: null,
    confirmedAt: null,
    confirmationVersion: 0,
    createdAt,
  };

  if (sb) {
    const { error } = await sb.insertTrip({
      id,
      data: trip,
      status: "collecting",
      organizer_actor_key: organizer?.actorKey || null,
      organizer_email_normalized: organizerEmail || null,
      confirmed_date: null,
      confirmed_at: null,
      confirmation_version: 0,
      updated_at: createdAt,
    });
    if (error) throw new Error("Storage write failed");
  } else {
    memoryTrips.set(id, {
      trip,
      organizerActorKey: organizer?.actorKey || null,
      organizerEmailNormalized: organizerEmail || null,
    });
  }

  return id;
}

export async function submitAvailability(
  tripId: string,
  actor: Actor,
  input: AvailabilityInput,
): Promise<TripResponse> {
  const submittedAt = new Date().toISOString();
  // Security: a signed-in actor's session email always wins over any email
  // submitted in the request body. The body-submitted address is only used
  // as a fallback when the actor has none (i.e. an anonymous capability
  // actor). Letting a request body override a signed-in actor's email would
  // let anyone redirect another participant's confirmation email to an
  // address they control; the email is contact data only and never affects
  // actor identity, which stays the capability hash.
  const email = normalizeEmail(actor.email) || normalizeEmail(input.email);
  const responseData = {
    ...versionedAnswers(input),
    name: input.name,
    email,
    selectedDates: [...input.selectedDates],
    preferences: { ...input.preferences },
    conflictCount: input.conflictCount,
    submittedAt,
  };
  const sb = getSupabase();

  if (sb) {
    const { data, error } = await sb.rpc("submit_trip_response", {
      p_trip_id: tripId,
      p_actor_key: actor.actorKey,
      p_data: responseData,
    });
    if (error) {
      if (error.message?.includes("ORGANIZER_RESPONSE_FORBIDDEN")) throw new ForbiddenError("The organizer is already included in availability");
      if (error.message?.includes("ANSWER_VERSION_REQUIRED"))
        throw new ConflictError(
          "answer_version_required",
          "Refresh this page before editing your response",
        );
      if (error.message?.includes("INVITATIONS_CLOSED"))
        throw new ConflictError(
          "invitations_closed",
          "The organizer has closed responses",
        );
      throw new Error("Storage RPC failed");
    }
    const result = parseSubmitRpc(data);
    if (result.resultCode !== "created" && result.resultCode !== "updated") {
      mapSubmitFailure(result.resultCode);
    }
    if (!result.responsePublicId) {
      throw new Error("Storage RPC returned an invalid response");
    }
    return {
      publicId: result.responsePublicId,
      ...responseData,
    };
  }

  return withTripMutex(tripId, async () => {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    if (loaded.organizerActorKey === actor.actorKey) throw new ForbiddenError("The organizer is already included in availability");
    if (loaded.trip.status !== "collecting") {
      throw new ConflictError("trip_confirmed", "Trip is already confirmed");
    }
    if (loaded.trip.planning?.invitationsClosed)
      throw new ConflictError(
        "invitations_closed",
        "The organizer has closed responses",
      );
    assertCandidateDates(loaded.trip, input.selectedDates);

    if (!memoryResponses.has(tripId)) memoryResponses.set(tripId, new Map());
    const responses = memoryResponses.get(tripId)!;
    const existing = responses.get(actor.actorKey);
    if (existing?.response.answerVersion === 2 && input.answerVersion !== 2) {
      throw new ConflictError(
        "answer_version_required",
        "Refresh this page before editing your response",
      );
    }
    if (!existing && responses.size >= 100) throw new CapacityError();
    const response: TripResponse = {
      publicId: existing?.response.publicId || randomUUID(),
      ...responseData,
      submittedAt: existing?.response.submittedAt || submittedAt,
    };
    responses.set(actor.actorKey, { actorKey: actor.actorKey, response });
    return { ...response };
  });
}

export async function updateTripPlanning(
  tripId: string,
  actor: Actor,
  input: unknown,
): Promise<ManagedTrip> {
  const sb = getSupabase();
  if (sb) {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    assertOrganizer(loaded, actor);
    const planning = parsePlanning(
      input,
      loaded.trip.responses.map((response) => response.publicId),
    );
    const { data, error } = await sb.rpc("update_trip_planning", {
      p_trip_id: tripId,
      p_actor_key: actor.actorKey,
      p_planning: planning,
    });
    if (error) throw new Error("Storage RPC failed");
    const code = parseCompletionRpc(data);
    if (code === "stale")
      throw new ConflictError(
        "stale_settings",
        "Responses changed; refresh before saving settings",
      );
    if (code === "trip_confirmed")
      throw new ConflictError(
        "trip_confirmed",
        "Reopen the trip before changing settings",
      );
    if (code !== "updated") mapLifecycleFailure(code);
    return getManagedTrip(tripId, actor);
  }
  return withTripMutex(tripId, async () => {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    assertOrganizer(loaded, actor);
    if (loaded.trip.status !== "collecting")
      throw new ConflictError(
        "trip_confirmed",
        "Reopen the trip before changing settings",
      );
    const planning = parsePlanning(
      input,
      loaded.trip.responses.map((response) => response.publicId),
    );
    if (planning.revision !== (loaded.trip.planning?.revision || 0))
      throw new ConflictError(
        "stale_settings",
        "Responses changed; refresh before saving settings",
      );
    planning.revision += 1;
    const stored = memoryTrips.get(tripId)!;
    memoryTrips.set(tripId, { ...stored, trip: { ...stored.trip, planning } });
    return { ...loaded.trip, planning };
  });
}

export async function getViewerState(
  tripId: string,
  actor: Actor | null,
): Promise<ViewerState> {
  const loaded = await loadTrip(tripId);
  if (!loaded) throw new NotFoundError();
  const isOrganizer =
    actor !== null && loaded.organizerActorKey === actor.actorKey;
  const ownResponse = actor
    ? loaded.responsesByActor.get(actor.actorKey) || null
    : null;
  return {
    trip: toPublicTrip(loaded.trip),
    role: isOrganizer ? "organizer" : ownResponse ? "respondent" : "viewer",
    response: ownResponse ? ownTripResponse(ownResponse) : null,
  };
}

export async function getManagedTrip(
  tripId: string,
  actor: Actor,
  options: { claimLegacy?: boolean } = {},
): Promise<ManagedTrip> {
  const loaded = await loadTrip(tripId);
  if (!loaded) throw new NotFoundError();
  if (loaded.organizerActorKey === actor.actorKey) {
    return normalizeTrip(loaded.trip);
  }
  if (!options.claimLegacy) throw new ForbiddenError();

  const actorEmail = normalizeEmail(actor.email);
  if (
    actor.kind !== "account" ||
    loaded.organizerActorKey !== null ||
    !actorEmail ||
    loaded.organizerEmailNormalized !== actorEmail
  ) {
    throw new ForbiddenError();
  }

  const sb = getSupabase();
  if (sb) {
    const { data: claimedRow, error } = await sb
      .claimUnownedTrip(tripId, actor.actorKey, actorEmail, new Date().toISOString());
    if (error) throw new Error("Storage write failed");
    if (claimedRow) {
      if (
        !isRecord(claimedRow) ||
        claimedRow.organizer_actor_key !== actor.actorKey
      ) {
        throw new Error("Storage returned invalid trip data");
      }
      return normalizeTrip(loaded.trip);
    }

    const current = await loadTrip(tripId);
    if (!current) throw new NotFoundError();
    assertOrganizer(current, actor);
    return normalizeTrip(current.trip);
  }

  return withTripMutex(tripId, async () => {
    const current = memoryTrips.get(tripId);
    if (!current) throw new NotFoundError();
    if (current.organizerActorKey === actor.actorKey) {
      const currentLoaded = await loadTrip(tripId);
      if (!currentLoaded) throw new NotFoundError();
      return normalizeTrip(currentLoaded.trip);
    }
    if (
      current.organizerActorKey !== null ||
      current.organizerEmailNormalized !== actorEmail
    ) {
      throw new ForbiddenError();
    }
    memoryTrips.set(tripId, {
      ...current,
      organizerActorKey: actor.actorKey,
    });
    const claimed = await loadTrip(tripId);
    if (!claimed) throw new NotFoundError();
    return normalizeTrip(claimed.trip);
  });
}

export async function confirmTripOnce(
  tripId: string,
  actor: Actor,
  date: string,
): Promise<ConfirmResult> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc("confirm_trip_once", {
      p_trip_id: tripId,
      p_actor_key: actor.actorKey,
      p_date: date,
    });
    if (error) throw new Error("Storage RPC failed");
    const result = parseLifecycleRpc(data);
    if (
      result.resultCode !== "confirmed" &&
      result.resultCode !== "already_confirmed"
    ) {
      mapLifecycleFailure(result.resultCode);
    }
    if (result.confirmationVersion === null) {
      throw new Error("Storage RPC returned an invalid response");
    }
    const trip = await getTrip(tripId);
    if (
      !trip ||
      trip.status !== "confirmed" ||
      trip.confirmedDate !== date ||
      trip.confirmationVersion !== result.confirmationVersion
    ) {
      throw new ConflictError(
        "superseded",
        "Lifecycle transition was superseded",
      );
    }
    return {
      trip,
      confirmedDate: date,
      confirmationVersion: result.confirmationVersion,
      alreadyConfirmed: result.resultCode === "already_confirmed",
    };
  }

  return withTripMutex(tripId, async () => {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    assertOrganizer(loaded, actor);
    if (loaded.trip.status === "confirmed") {
      if (loaded.trip.confirmedDate !== date) {
        throw new ConflictError(
          "conflict",
          "Trip is confirmed for another date",
        );
      }
      return {
        trip: normalizeTrip(loaded.trip),
        confirmedDate: date,
        confirmationVersion: loaded.trip.confirmationVersion,
        alreadyConfirmed: true,
      };
    }
    assertCandidateDates(loaded.trip, [date]);

    const confirmedAt = new Date().toISOString();
    const nextVersion = loaded.trip.confirmationVersion + 1;
    const confirmedTrip: Trip = {
      ...loaded.trip,
      responses: [],
      status: "confirmed",
      confirmedDate: date,
      confirmedAt,
      confirmationVersion: nextVersion,
    };
    const stored = memoryTrips.get(tripId)!;
    memoryTrips.set(tripId, { ...stored, trip: confirmedTrip });
    const deliveries = new Map<string, StoredDelivery>();
    loaded.responsesByActor.forEach((response) => {
      if (!response.email) return;
      deliveries.set(response.publicId, {
        responsePublicId: response.publicId,
        toEmail: response.email,
        status: "pending",
        attemptCount: 0,
        updatedAt: Date.now(),
      });
    });
    memoryDeliveries.set(deliveryKey(tripId, nextVersion), deliveries);
    return {
      trip: mergeTripResponses(confirmedTrip, loaded.responsesByActor.values()),
      confirmedDate: date,
      confirmationVersion: nextVersion,
      alreadyConfirmed: false,
    };
  });
}

export async function claimConfirmationDeliveries(
  tripId: string,
  actor: Actor,
  confirmationVersion: number,
): Promise<ConfirmationDelivery[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc("claim_confirmation_deliveries", {
      p_trip_id: tripId,
      p_actor_key: actor.actorKey,
      p_confirmation_version: confirmationVersion,
    });
    if (error) throw new Error("Storage RPC failed");
    const result = parseClaimDeliveriesRpc(data);
    if (result.resultCode === "none") return [];
    if (result.resultCode !== "claimed") {
      mapLifecycleFailure(result.resultCode);
    }
    return result.deliveries;
  }

  return withTripMutex(tripId, async () => {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    assertOrganizer(loaded, actor);
    if (
      loaded.trip.status !== "confirmed" ||
      loaded.trip.confirmationVersion !== confirmationVersion
    ) {
      throw new ConflictError(
        "superseded",
        "Confirmation delivery work was superseded",
      );
    }

    const deliveries =
      memoryDeliveries.get(deliveryKey(tripId, confirmationVersion)) ||
      new Map<string, StoredDelivery>();
    const now = Date.now();
    const claimed: ConfirmationDelivery[] = [];
    deliveries.forEach((delivery) => {
      if (
        delivery.leaseToken ||
        delivery.attemptCount >= 8 ||
        (delivery.nextAttemptAt || 0) > now
      )
        return;
      const staleClaim =
        delivery.status === "sending" &&
        now - delivery.updatedAt >= 10 * 60 * 1000;
      if (
        delivery.status !== "pending" &&
        delivery.status !== "failed" &&
        !staleClaim
      ) {
        return;
      }
      delivery.status = "sending";
      delivery.attemptCount++;
      delivery.updatedAt = now;
      claimed.push({
        responsePublicId: delivery.responsePublicId,
        toEmail: delivery.toEmail,
      });
    });
    return claimed;
  });
}

export async function completeConfirmationDelivery(
  tripId: string,
  actor: Actor,
  confirmationVersion: number,
  responsePublicId: string,
  succeeded: boolean,
): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc("complete_confirmation_delivery", {
      p_trip_id: tripId,
      p_actor_key: actor.actorKey,
      p_confirmation_version: confirmationVersion,
      p_response_public_id: responsePublicId,
      p_succeeded: succeeded,
    });
    if (error) throw new Error("Storage RPC failed");
    const resultCode = parseCompletionRpc(data);
    if (resultCode !== "completed") mapLifecycleFailure(resultCode);
    return;
  }

  return withTripMutex(tripId, async () => {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    assertOrganizer(loaded, actor);
    const delivery = memoryDeliveries
      .get(deliveryKey(tripId, confirmationVersion))
      ?.get(responsePublicId);
    if (!delivery || delivery.status !== "sending" || delivery.leaseToken) {
      throw new ConflictError(
        "conflict",
        "Confirmation delivery is not claimed",
      );
    }
    delivery.status = succeeded ? "sent" : "failed";
    delivery.updatedAt = Date.now();
  });
}

export async function reopenTrip(tripId: string, actor: Actor): Promise<Trip> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc("reopen_trip", {
      p_trip_id: tripId,
      p_actor_key: actor.actorKey,
    });
    if (error) throw new Error("Storage RPC failed");
    const result = parseLifecycleRpc(data);
    if (
      result.resultCode !== "reopened" &&
      result.resultCode !== "already_collecting"
    ) {
      mapLifecycleFailure(result.resultCode);
    }
    if (result.confirmationVersion === null) {
      throw new Error("Storage RPC returned an invalid response");
    }
    const trip = await getTrip(tripId);
    if (
      !trip ||
      trip.status !== "collecting" ||
      trip.confirmedDate !== null ||
      trip.confirmationVersion !== result.confirmationVersion
    ) {
      throw new ConflictError(
        "superseded",
        "Lifecycle transition was superseded",
      );
    }
    return trip;
  }

  return withTripMutex(tripId, async () => {
    const loaded = await loadTrip(tripId);
    if (!loaded) throw new NotFoundError();
    assertOrganizer(loaded, actor);
    if (loaded.trip.status === "collecting" && !loaded.trip.planning?.invitationsClosed) return normalizeTrip(loaded.trip);

    const reopened: Trip = {
      ...loaded.trip,
      responses: [],
      planning: {...(loaded.trip.planning || emptyPlanning()), invitationsClosed: false, revision: (loaded.trip.planning?.revision || 0) + 1},
      status: "collecting",
      confirmedDate: null,
      confirmedAt: null,
    };
    const stored = memoryTrips.get(tripId)!;
    memoryTrips.set(tripId, { ...stored, trip: reopened });
    return mergeTripResponses(reopened, loaded.responsesByActor.values());
  });
}

export async function listTripsForActor(actor: Actor): Promise<TripSummary[]> {
  const sb = getSupabase();
  const summaries = new Map<string, TripSummary>();

  if (sb) {
    const { data: organizerRows, error: organizerError } = await sb
      .ownedTripRows(actor.actorKey);
    if (organizerError) throw new Error("Storage read failed");
    for (const row of organizerRows || []) {
      const stored = tripFromRow(row);
      summaries.set(stored.trip.id, tripSummary(stored.trip, "organizer"));
    }

    const { data: responseRows, error: responseError } = await sb
      .responseTripIds(actor.actorKey);
    if (responseError) throw new Error("Storage read failed");
    const responseTripIds = Array.from(
      new Set(
        (responseRows || [])
          .map((row) =>
            isRecord(row) && typeof row.trip_id === "string"
              ? row.trip_id
              : null,
          )
          .filter((id): id is string => id !== null && !summaries.has(id)),
      ),
    );
    if (responseTripIds.length > 0) {
      const { data: tripRows, error: tripError } = await sb
        .tripRowsByIds(responseTripIds);
      if (tripError) throw new Error("Storage read failed");
      for (const row of tripRows || []) {
        const stored = tripFromRow(row);
        summaries.set(stored.trip.id, tripSummary(stored.trip, "respondent"));
      }
    }
  } else {
    memoryTrips.forEach((stored, tripId) => {
      if (stored.organizerActorKey === actor.actorKey) {
        summaries.set(tripId, tripSummary(stored.trip, "organizer"));
      } else if (memoryResponses.get(tripId)?.has(actor.actorKey)) {
        summaries.set(tripId, tripSummary(stored.trip, "respondent"));
      }
    });
  }

  return Array.from(summaries.values()).sort((left, right) => {
    const createdOrder = right.createdAt.localeCompare(left.createdAt);
    return createdOrder || left.id.localeCompare(right.id);
  });
}

export interface NotificationClaim extends ConfirmationDelivery {
  tripId: string;
  confirmationVersion: number;
  leaseToken: string;
}
export interface NotificationSummary {
  total: number;
  sent: number;
  pending: number;
  failed: number;
}
// Service-side workers only. HTTP callers must authenticate separately.
export async function claimNotificationBatch(
  tripId?: string,
  limit = 3,
): Promise<NotificationClaim[]> {
  const sb = getSupabase();
  limit = Math.max(1, Math.min(50, Math.floor(limit)));
  if (sb) {
    const { data, error } = await sb.rpc("claim_notification_batch", {
      p_trip_id: tripId || null,
      p_limit: limit,
    });
    if (error || !Array.isArray(data))
      throw new Error("Notification storage unavailable");
    return data.map((row) => {
      if (
        typeof row.trip_id !== "string" ||
        !Number.isSafeInteger(row.confirmation_version) ||
        typeof row.response_public_id !== "string" ||
        typeof row.to_email !== "string" ||
        typeof row.lease_token !== "string"
      )
        throw new Error("Invalid notification claim");
      return {
        tripId: row.trip_id,
        confirmationVersion: row.confirmation_version,
        responsePublicId: row.response_public_id,
        toEmail: row.to_email,
        leaseToken: row.lease_token,
      };
    });
  }
  const claims: NotificationClaim[] = [];
  for (const id of tripId ? [tripId] : Array.from(memoryTrips.keys()).sort()) {
    if (claims.length >= limit) break;
    await withTripMutex(id, async () => {
      const trip = memoryTrips.get(id)?.trip;
      if (!trip || trip.status !== "confirmed") return;
      const deliveries = memoryDeliveries.get(
        deliveryKey(id, trip.confirmationVersion),
      );
      const now = Date.now();
      for (const delivery of Array.from(deliveries?.values() || [])) {
        if (claims.length >= limit) break;
        const due =
          delivery.status === "sending"
            ? (delivery.leaseExpiresAt || delivery.updatedAt + 600000) <= now
            : (delivery.status === "pending" || delivery.status === "failed") &&
              (delivery.nextAttemptAt || 0) <= now;
        if (!due || delivery.attemptCount >= 8) continue;
        delivery.status = "sending";
        delivery.attemptCount++;
        delivery.updatedAt = now;
        delivery.leaseToken = randomUUID();
        delivery.leaseExpiresAt = now + 90000;
        claims.push({
          tripId: id,
          confirmationVersion: trip.confirmationVersion,
          responsePublicId: delivery.responsePublicId,
          toEmail: delivery.toEmail,
          leaseToken: delivery.leaseToken,
        });
      }
    });
  }
  return claims;
}
function notificationArgs(claim: NotificationClaim) {
  return {
    p_trip_id: claim.tripId,
    p_confirmation_version: claim.confirmationVersion,
    p_response_public_id: claim.responsePublicId,
    p_lease_token: claim.leaseToken,
  };
}
function currentMemoryDelivery(
  claim: NotificationClaim,
): StoredDelivery | null {
  const trip = memoryTrips.get(claim.tripId)?.trip;
  const delivery = memoryDeliveries
    .get(deliveryKey(claim.tripId, claim.confirmationVersion))
    ?.get(claim.responsePublicId);
  return trip?.status === "confirmed" &&
    trip.confirmationVersion === claim.confirmationVersion &&
    delivery?.status === "sending" &&
    delivery.leaseToken === claim.leaseToken &&
    (delivery.leaseExpiresAt || 0) > Date.now()
    ? delivery
    : null;
}
export async function notificationClaimIsCurrent(
  claim: NotificationClaim,
): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc(
      "notification_claim_is_current",
      notificationArgs(claim),
    );
    if (error || typeof data !== "boolean")
      throw new Error("Notification storage unavailable");
    return data;
  }
  return Boolean(currentMemoryDelivery(claim));
}
export async function finishNotification(
  claim: NotificationClaim,
  succeeded: boolean,
): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc("finish_notification", {
      ...notificationArgs(claim),
      p_succeeded: succeeded,
    });
    if (error || typeof data !== "boolean")
      throw new Error("Notification storage unavailable");
    return data;
  }
  return withTripMutex(claim.tripId, async () => {
    const delivery = currentMemoryDelivery(claim);
    if (!delivery) return false;
    delivery.status = succeeded ? "sent" : "failed";
    delivery.updatedAt = Date.now();
    delivery.nextAttemptAt =
      Date.now() + Math.min(21600000, 60000 * 2 ** (delivery.attemptCount - 1));
    delete delivery.leaseToken;
    delete delivery.leaseExpiresAt;
    return true;
  });
}
export async function getNotificationSummary(
  tripId: string,
  version: number,
): Promise<NotificationSummary> {
  const sb = getSupabase();
  let rows: { status: string; attempt_count?: number }[];
  if (sb) {
    const { data, error } = await sb
      .deliveryStates(tripId, version);
    if (error || !Array.isArray(data))
      throw new Error("Notification storage unavailable");
    rows = data;
  } else
    rows = Array.from(
      memoryDeliveries.get(deliveryKey(tripId, version))?.values() || [],
    ).map((d) => ({ status: d.status, attempt_count: d.attemptCount }));
  return rows.reduce(
    (summary, row) => {
      summary.total++;
      if (row.status === "sent") summary.sent++;
      else if (row.status === "failed" || (row.attempt_count || 0) >= 8)
        summary.failed++;
      else summary.pending++;
      return summary;
    },
    { total: 0, sent: 0, pending: 0, failed: 0 },
  );
}

export async function releaseNotificationClaim(
  claim: NotificationClaim,
): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.rpc(
      "release_notification_claim",
      notificationArgs(claim),
    );
    if (error || typeof data !== "boolean")
      throw new Error("Notification storage unavailable");
    return data;
  }
  return withTripMutex(claim.tripId, async () => {
    const delivery = currentMemoryDelivery(claim);
    if (!delivery) return false;
    delivery.status = "pending";
    delivery.attemptCount = Math.max(0, delivery.attemptCount - 1);
    delivery.nextAttemptAt = Date.now();
    delete delivery.leaseToken;
    delete delivery.leaseExpiresAt;
    return true;
  });
}
