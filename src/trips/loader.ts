import DataLoader from "dataloader";
import type { RestClient, Trip } from "../rest/client.js";

const REST_BATCH_LIMIT = 100;

/**
 * Coalesces trip reads within one request into REST batch calls. Create one per request and
 * principal: the cache holds that caller's private trips and must never outlive the request.
 */
export function createTripLoader(rest: RestClient, ownerId: string) {
  return new DataLoader<string, Trip | null>(
    async (ids) => {
      const byId = new Map((await rest.batch(ids)).map((trip) => [trip.id, trip]));
      return ids.map((id) => {
        const trip = byId.get(id);
        return trip && trip.ownerId === ownerId ? trip : null;
      });
    },
    { maxBatchSize: REST_BATCH_LIMIT }
  );
}
export type TripLoader = ReturnType<typeof createTripLoader>;
