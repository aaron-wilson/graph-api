import { z } from "zod";
import { getJson, type HttpTransport } from "./http.js";
import { citySchema, eventSchema, type EventsProvider, ProviderError } from "./port.js";

const responseSchema = z.object({
  _embedded: z
    .object({
      events: z
        .array(
          z.object({
            name: z.string(),
            dates: z.object({ start: z.object({ localDate: z.string() }) }),
          })
        )
        .max(100),
    })
    .optional(),
});
export function createTicketmasterEvents(
  endpoint: string,
  apiKey: string,
  transport: HttpTransport
): EventsProvider {
  return {
    async find(city, signal) {
      const url = new URL(endpoint);
      url.searchParams.set("apikey", apiKey);
      url.searchParams.set("city", citySchema.parse(city));
      url.searchParams.set("size", "10");
      const raw = await getJson(transport, url.toString(), responseSchema, {}, signal);
      const events = (raw._embedded?.events ?? []).slice(0, 10).map((item) => ({
        name: item.name,
        date: item.dates.start.localDate,
      }));
      const parsed = z.array(eventSchema).safeParse(events);
      if (!parsed.success) throw new ProviderError("invalid_response");
      return parsed.data;
    },
  };
}
