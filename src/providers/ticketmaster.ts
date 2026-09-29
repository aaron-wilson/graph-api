import { z } from "zod";
import { getJson, type HttpTransport } from "./http.js";
import { citySchema, eventSchema, type EventsProvider } from "./port.js";

const responseSchema = z.object({
  _embedded: z
    .object({
      events: z.array(z.unknown()).max(100),
    })
    .optional(),
});
const itemSchema = z.object({
  name: z.string(),
  dates: z.object({ start: z.object({ localDate: z.string().optional() }) }),
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
      const events: z.infer<typeof eventSchema>[] = [];
      for (const value of raw._embedded?.events ?? []) {
        const item = itemSchema.safeParse(value);
        if (!item.success) continue;
        const parsed = eventSchema.safeParse({
          name: item.data.name.trim().slice(0, 120),
          date: item.data.dates.start.localDate,
        });
        if (parsed.success) events.push(parsed.data);
        if (events.length === 10) break;
      }
      return events;
    },
  };
}
