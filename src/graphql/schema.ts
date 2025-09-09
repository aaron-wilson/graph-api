// src/schema.ts
import { createSchema } from "graphql-yoga";
import { resolvers } from "./resolvers";

export const schema = createSchema({
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
  resolvers,
});
