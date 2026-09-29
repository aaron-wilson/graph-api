import { GraphQLError } from "graphql";
import { RestError } from "../rest/client.js";
import { InvalidInput, TripNotFound, Unauthenticated } from "../trips/errors.js";

const REST_ERRORS: Record<number, [message: string, code: string]> = {
  400: ["Invalid input", "BAD_USER_INPUT"],
  401: ["Authentication required", "UNAUTHENTICATED"],
  403: ["Forbidden", "FORBIDDEN"],
  404: ["Trip not found", "NOT_FOUND"],
  409: ["Trip version conflict", "CONFLICT"],
  429: ["Rate limit exceeded", "RATE_LIMITED"],
};

function publicShape(error: Error): [message: string, code: string] | null {
  if (error instanceof InvalidInput) return [error.message, "BAD_USER_INPUT"];
  if (error instanceof Unauthenticated) return [error.message, "UNAUTHENTICATED"];
  if (error instanceof TripNotFound) return [error.message, "NOT_FOUND"];
  if (error instanceof RestError) return REST_ERRORS[error.status] ?? null;
  return null;
}

/**
 * Maps known service errors to safe client errors. Anything else, including provider errors
 * shaped like GraphQL input errors, returns null and is masked by Yoga.
 */
export function toPublicError(error: unknown): GraphQLError | null {
  if (!(error instanceof GraphQLError)) return null;
  const cause = error.originalError;
  if (!cause) return null;
  const shape = publicShape(cause);
  if (!shape) return null;
  return new GraphQLError(shape[0], {
    nodes: error.nodes ?? null,
    path: error.path ?? null,
    extensions: { code: shape[1] },
  });
}

export function invalidToken() {
  return new GraphQLError("Invalid token", {
    extensions: { code: "UNAUTHENTICATED", http: { status: 401 } },
  });
}

/**
 * Keeps request-level GraphQL errors (parse, validation, invalid token), maps known service
 * errors, and masks every other resolver or context failure, including thrown GraphQLErrors.
 */
export function maskGraphError(error: unknown, message: string): Error {
  const visible = toPublicError(error);
  if (visible) return visible;
  if (error instanceof GraphQLError && !error.originalError) return error;
  return new GraphQLError(message, {
    nodes: error instanceof GraphQLError ? (error.nodes ?? null) : null,
    path: error instanceof GraphQLError ? (error.path ?? null) : null,
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  });
}
