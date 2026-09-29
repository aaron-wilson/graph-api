export interface Principal {
  id: string;
}
/** Resolves an Authorization header to a principal; null means an anonymous caller. */
export interface AuthPort {
  authenticate(header: string | null): Promise<Principal | null>;
}
export class Unauthorized extends Error {}
