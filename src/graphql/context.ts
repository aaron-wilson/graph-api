import { Unauthorized, type AuthPort, type Principal } from "../auth/port.js";
import type { PlanningProviders } from "../providers/port.js";
import { createRestClient } from "../rest/client.js";
import { createTripService, type TripService } from "../trips/service.js";
import type { GenerationManager } from "../trips/generations.js";
import { invalidToken } from "./errors.js";

export interface GraphContext {
  principal: Principal | null;
  trips: TripService;
  generations: GenerationManager;
}
export interface ContextDeps {
  auth: AuthPort;
  providers: PlanningProviders;
  restUrl: string;
  restTimeoutMs: number;
  restFetch: typeof fetch;
  generations: GenerationManager;
}

/** Authenticates once per request and builds services bound to that caller's credentials. */
export function createContextFactory(deps: ContextDeps) {
  return async ({ request }: { request: Request }): Promise<GraphContext> => {
    const header = request.headers.get("authorization");
    let principal: Principal | null;
    try {
      principal = await deps.auth.authenticate(header);
    } catch (error) {
      if (error instanceof Unauthorized) throw invalidToken();
      throw error;
    }
    const rest = createRestClient(
      deps.restUrl,
      principal ? header : null,
      deps.restTimeoutMs,
      deps.restFetch
    );
    return {
      principal,
      generations: deps.generations,
      trips: createTripService({
        rest,
        providers: deps.providers,
        principal,
        signal: request.signal,
      }),
    };
  };
}
