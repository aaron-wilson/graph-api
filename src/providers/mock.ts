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
      for (const chunk of [
        `Plan for ${value.slice(0, 80)}.`,
        " Explore the city at your own pace.",
      ]) {
        if (signal?.aborted) throw new ProviderError("cancelled");
        yield chunk;
      }
    },
  },
};
