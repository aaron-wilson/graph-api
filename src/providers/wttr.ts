import { z } from "zod";
import { getJson, type HttpTransport } from "./http.js";
import { citySchema, weatherSchema, ProviderError, type WeatherProvider } from "./port.js";

const responseSchema = z.object({
  current_condition: z
    .array(z.object({ weatherDesc: z.array(z.object({ value: z.string() })).min(1) }))
    .min(1),
});
export function createWttrWeather(endpoint: string, transport: HttpTransport): WeatherProvider {
  return {
    async current(city, signal) {
      const value = citySchema.parse(city);
      const url = `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(value)}?format=j1`;
      const raw = await getJson(transport, url, responseSchema, {}, signal);
      const parsed = weatherSchema.safeParse(raw.current_condition[0]?.weatherDesc[0]?.value);
      if (!parsed.success) throw new ProviderError("invalid_response");
      return parsed.data;
    },
  };
}
