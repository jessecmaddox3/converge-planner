import { getAppSession } from "@/lib/runtime/session";
import { capabilityActor } from "@/lib/actor";
import { ApiError, jsonError } from "@/lib/http";
import {
  CapacityError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type Actor,
} from "@/lib/store";

export const TRIP_CREATE_MAX_BODY_BYTES = 16_384;
export const TRIP_AVAILABILITY_MAX_BODY_BYTES = 16_384;
export const TRIP_CONFIRMATION_MAX_BODY_BYTES = 1_024;

const CAPABILITY_AUTH_RE = /^Capability ([A-Za-z0-9_-]{43})$/;
const VALIDATION_CODES = new Set([
  "INVALID_INPUT",
  "INVALID_NAME",
  "INVALID_DATE",
  "DATE_RANGE_REVERSED",
  "RANGE_TOO_LARGE",
  "INVALID_DURATION",
  "INVALID_PRESET",
  "INVALID_NOTES",
  "INVALID_CANDIDATE_COUNT",
  "DUPLICATE_CANDIDATE",
  "INVALID_CANDIDATE",
  "INVALID_SELECTED_DATES",
  "DUPLICATE_DATE",
  "DATE_NOT_PROPOSED",
  "PREFERENCE_DATE_NOT_SELECTED",
  "INVALID_PREFERENCE",
  "INVALID_CONFLICT_COUNT",
]);

function accountActorFromSession(
  user:
    | {
        actorId?: unknown;
        name?: string | null;
        email?: string | null;
      }
    | undefined,
): Actor | null {
  if (!user || typeof user.actorId !== "string" || !user.actorId) return null;
  return {
    actorKey: user.actorId,
    kind: "account",
    name: typeof user.name === "string" ? user.name.slice(0, 100) : undefined,
    email:
      typeof user.email === "string" ? user.email.slice(0, 200) : undefined,
  };
}

function capabilityActorFromRequest(req: Request): Actor | null {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;
  const match = CAPABILITY_AUTH_RE.exec(authorization);
  if (!match) {
    throw new ApiError(
      401,
      "INVALID_CAPABILITY",
      "A valid private return capability is required",
    );
  }
  return {
    actorKey: capabilityActor(match[1]),
    kind: "capability",
  };
}

export async function optionalViewerActor(req: Request): Promise<Actor | null> {
  const session = await getAppSession(req);
  const account = accountActorFromSession(session?.user);
  const capability = capabilityActorFromRequest(req);
  // An explicit private return link keeps its response slot after Google sign-in.
  // Calendar connection grants no authority over another slot; possession of the
  // capability still does. A session email remains authoritative for delivery.
  if (capability)
    return {
      ...capability,
      ...(account?.email ? { email: account.email } : {}),
    };
  if (account) return account;

  if (session?.user && !process.env.ACTOR_KEY_SECRET) {
    throw new ApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Actor identity is unavailable",
    );
  }
  return null;
}

export async function requireViewerActor(req: Request): Promise<Actor> {
  const actor = await optionalViewerActor(req);
  if (!actor) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Authentication or a private return capability is required",
    );
  }
  return actor;
}

export async function requireAccountActor(req: Request): Promise<Actor> {
  const session = await getAppSession(req);
  const actor = accountActorFromSession(session?.user);
  if (actor) return actor;
  if (session?.user && !process.env.ACTOR_KEY_SECRET) {
    throw new ApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Actor identity is unavailable",
    );
  }
  throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
}

function mappedApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  if (error instanceof NotFoundError) {
    return new ApiError(404, "NOT_FOUND", error.message);
  }
  if (error instanceof ForbiddenError) {
    return new ApiError(403, "FORBIDDEN", error.message);
  }
  if (error instanceof CapacityError) {
    return new ApiError(409, "CAPACITY_REACHED", error.message);
  }
  if (error instanceof ConflictError) {
    if (error.code === "invalid_argument")
      return new ApiError(
        422,
        "INVALID_INPUT",
        "Some trip settings are no longer valid. Refresh the trip and try again.",
      );
    if (
      error.code === "date_not_proposed" ||
      error.code === "invalid_candidate"
    ) {
      return new ApiError(
        422,
        "INVALID_CANDIDATE",
        "The selected date is not an organizer candidate",
      );
    }
    return new ApiError(409, error.code.toUpperCase(), error.message);
  }
  if (error instanceof Error) {
    if (error.message === "TRIP_CONFIRMED") {
      return new ApiError(409, "TRIP_CONFIRMED", "Trip is already confirmed");
    }
    if (VALIDATION_CODES.has(error.message)) {
      return new ApiError(
        422,
        error.message,
        "Trip request is semantically invalid",
      );
    }
  }
  return null;
}

export function tripRouteError(error: unknown, routeName: string): Response {
  const mapped = mappedApiError(error);
  if (!mapped) {
    console.error(
      `[${routeName}] Failed:`,
      error instanceof Error ? error.message : String(error),
    );
  }
  return jsonError(mapped || error);
}
