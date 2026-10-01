import { citySchema, promptSchema, ProviderError, type PlanningProviders } from "./port.js";

const hash = (input: string) =>
  [...input.toLowerCase()].reduce((sum, char) => sum + char.charCodeAt(0), 0);
export const mockProviders: PlanningProviders = {
  weather: {
    async current(city) {
      const choices = ["Clear", "Cloudy", "Mild"];
      return choices[hash(citySchema.parse(city)) % choices.length] ?? "Mild";
    },
  },
  places: {
    async find(city) {
      const value = citySchema.parse(city);
      return [{ name: `Central ${value} Museum`, category: "museum" }];
    },
  },
  events: {
    async find(city) {
      citySchema.parse(city);
      return [{ name: "Local music", date: "2026-10-02" }];
    },
  },
  llm: {
    async *stream(prompt, signal) {
      const value = promptSchema.parse(prompt);
      // The planner uses the streamed text as an activity title, so it must read as one.
      const city = /^Plan activities in (.+?) for\b/.exec(value)?.[1] ?? "the city";
      for (const chunk of [
        `Start with an unhurried walk through ${city.slice(0, 60)},`,
        " pausing wherever something catches your eye.",
      ]) {
        if (signal?.aborted) throw new ProviderError("cancelled");
        yield chunk;
      }
    },
  },
};
