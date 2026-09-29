import type { Resolvers } from "./generated.js";
import { Unauthenticated, TripNotFound } from "../trips/errors.js";

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
    startCreateGeneration: (_, { input }, { trips, generations, principal }) => {
      if (!principal) throw new Unauthenticated();
      const plan = trips.prepareCreate(input);
      return generations.start(principal.id, `${principal.id}:create`, (signal, emit) =>
        trips.generateCreate(plan, emit, signal)
      );
    },
    startRefineGeneration: async (_, { input }, { trips, generations, principal }) => {
      if (!principal) throw new Unauthenticated();
      const plan = await trips.prepareRefine(input);
      return generations.start(principal.id, `${principal.id}:${plan.trip.id}`, (signal, emit) =>
        trips.generateRefine(plan, emit, signal)
      );
    },
    cancelGeneration: (_, { id }, { generations, principal }) => {
      if (!principal) throw new Unauthenticated();
      const job = generations.cancel(id, principal.id);
      if (!job) throw new TripNotFound();
      return job;
    },
  },
};
