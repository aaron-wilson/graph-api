import { createSchema } from "graphql-yoga";
import { createResolvers, type WeatherProvider } from "./resolvers.js";

export function createTripSchema(weather: WeatherProvider) {
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
    resolvers: createResolvers(weather),
  });
}
