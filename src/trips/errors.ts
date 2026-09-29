/** Input the caller can correct; its message is safe to return. */
export class InvalidInput extends Error {}
/** An operation needs an authenticated principal. */
export class Unauthenticated extends Error {
  constructor() {
    super("Authentication required");
  }
}
export class TripNotFound extends Error {
  constructor() {
    super("Trip not found");
  }
}
