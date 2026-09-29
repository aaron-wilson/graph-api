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
/** The caller or the process already runs the maximum number of generations. */
export class GenerationLimit extends Error {
  constructor() {
    super("Too many active generations");
  }
}
