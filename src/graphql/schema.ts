import { createSchema } from "graphql-yoga";
import { createResolvers } from "./resolvers.js";
import type { PlanningProviders } from "../providers/port.js";

export function createTripSchema(providers: PlanningProviders) {
  return createSchema({
    typeDefs: /* GraphQL */ `
      type Query {
        planTrip(city: String!, preferences: [String!]!): TripPlan!
      }
      type TripPlan {
        itinerary: String!
        currentWeather: String
        activityOptions: [String!]
      }
    `,
    resolvers: createResolvers(providers),
  });
}
