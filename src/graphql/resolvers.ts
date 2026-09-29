import type { Resolvers } from "./generated.js";

export const resolvers: Resolvers = {
  Pace: { RELAXED: "relaxed", BALANCED: "balanced", BUSY: "busy" },
  Query: {
    trip: (_, { id }, { trips }) => trips.trip(id),
    trips: (_, args, { trips }) => trips.trips(args),
    sharedTrip: (_, args, { trips }) => trips.sharedTrip(args),
  },
  Mutation: {
    createTrip: (_, { input }, { trips }) => trips.createTrip(input),
    refineTrip: (_, { input }, { trips }) => trips.refineTrip(input),
    pinActivity: (_, { input }, { trips }) => trips.pinActivity(input),
    swapActivity: (_, { input }, { trips }) => trips.swapActivity(input),
    shareTrip: (_, { input }, { trips }) => trips.shareTrip(input),
  },
};
