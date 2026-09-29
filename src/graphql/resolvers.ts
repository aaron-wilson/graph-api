import { z } from "zod";
import { GraphQLError } from "graphql";
import { mockProviders } from "../providers/mock.js";
import type { PlanningProviders } from "../providers/port.js";

export const deterministicWeather = mockProviders.weather;
const inputSchema = z.object({
  city: z.string().trim().min(1).max(100),
  preferences: z.array(z.string().trim().min(1).max(100)).max(20),
});
const validationErrors = new WeakSet<object>();
export function isPlanTripInputError(error: unknown): boolean {
  const seen = new WeakSet<object>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    if (validationErrors.has(error)) return true;
    seen.add(error);
    error = "originalError" in error ? error.originalError : null;
  }
  return false;
}
export function createResolvers(providers: PlanningProviders = mockProviders) {
  return {
    Query: {
      async planTrip(_: unknown, raw: unknown) {
        const parsed = inputSchema.safeParse(raw);
        if (!parsed.success) {
          const error = new GraphQLError("Invalid planTrip input", {
            extensions: { code: "BAD_USER_INPUT" },
          });
          validationErrors.add(error);
          throw error;
        }
        const { city, preferences } = parsed.data;
        const [currentWeather, places, events] = await Promise.all([
          providers.weather.current(city),
          providers.places.find(city),
          providers.events.find(city),
        ]);
        const activityOptions = [
          ...preferences.map((preference) => `Explore ${preference} in ${city}`),
          ...places.map((place) => `Visit ${place.name}`),
          ...events.map((event) => `Attend ${event.name}`),
        ];
        const prompt = `Plan three days in ${city}. Preferences: ${preferences.join(", ")}. Weather: ${currentWeather}. Places: ${places.map((place) => place.name).join(", ")}. Events: ${events.map((event) => event.name).join(", ")}.`;
        let itinerary = "";
        for await (const chunk of providers.llm.stream(prompt.slice(0, 4000))) itinerary += chunk;
        return {
          itinerary,
          currentWeather,
          activityOptions,
        };
      },
    },
  };
}
