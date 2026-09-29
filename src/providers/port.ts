import { z } from "zod";

export const citySchema = z.string().trim().min(1).max(100);
export const weatherSchema = z.string().trim().min(1).max(120);
export const placeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
});
export const eventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: z.string().date(),
});
export const promptSchema = z.string().trim().min(1).max(4000);
export interface WeatherProvider {
  current(city: string, signal?: AbortSignal): Promise<string>;
}
export interface PlacesProvider {
  find(city: string, signal?: AbortSignal): Promise<z.infer<typeof placeSchema>[]>;
}
export interface EventsProvider {
  find(city: string, signal?: AbortSignal): Promise<z.infer<typeof eventSchema>[]>;
}
export interface LlmProvider {
  stream(prompt: string, signal?: AbortSignal): AsyncIterable<string>;
}
export interface PlanningProviders {
  weather: WeatherProvider;
  places: PlacesProvider;
  events: EventsProvider;
  llm: LlmProvider;
}
export class ProviderError extends Error {
  constructor(
    public readonly code:
      | "timeout"
      | "rate_limit"
      | "unavailable"
      | "invalid_response"
      | "cancelled"
      | "output_limit"
  ) {
    super("Planning provider unavailable");
  }
}
