import { z } from "zod";

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
export function createResolvers(weather: WeatherProvider = deterministicWeather) {
  return {
    Query: {
      async planTrip(_: unknown, raw: unknown) {
        const { city, preferences } = inputSchema.parse(raw);
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
