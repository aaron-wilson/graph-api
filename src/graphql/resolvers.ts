import { z } from "zod";
import { GraphQLError } from "graphql";

export interface WeatherProvider {
  current(city: string): Promise<string>;
}
export const deterministicWeather: WeatherProvider = {
  async current(city) {
    const descriptions = ["Clear", "Cloudy", "Mild"];
    const index =
      [...city.toLowerCase()].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      descriptions.length;
    return descriptions[index] ?? "Mild";
  },
};
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
export function createResolvers(weather: WeatherProvider = deterministicWeather) {
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
        const currentWeather = await weather.current(city);
        const activityOptions = preferences.map((preference) => `Explore ${preference} in ${city}`);
        return {
          itinerary: `Three days in ${city}: ${activityOptions.join("; ") || "Explore the city"}.`,
          currentWeather,
          activityOptions,
        };
      },
    },
  };
}
