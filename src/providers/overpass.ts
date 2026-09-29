import { z } from "zod";
import { getJson, type HttpTransport } from "./http.js";
import { citySchema, placeSchema, type PlacesProvider } from "./port.js";

const responseSchema = z.object({
  elements: z.array(z.unknown()).max(100),
});
const itemSchema = z.object({
  tags: z.object({ name: z.string().optional(), tourism: z.string().optional() }).optional(),
});
export function createOverpassPlaces(endpoint: string, transport: HttpTransport): PlacesProvider {
  return {
    async find(city, signal) {
      const value = citySchema.parse(city);
      const query = `[out:json][timeout:15];area["name"=${JSON.stringify(value)}]->.city;node(area.city)["tourism"="attraction"];out 10;`;
      const raw = await getJson(
        transport,
        endpoint,
        responseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
        },
        signal
      );
      const places: z.infer<typeof placeSchema>[] = [];
      for (const value of raw.elements) {
        const item = itemSchema.safeParse(value);
        if (!item.success) continue;
        const parsed = placeSchema.safeParse({
          name: item.data.tags?.name?.trim().slice(0, 120) ?? "",
          category: item.data.tags?.tourism ?? "attraction",
        });
        if (parsed.success) places.push(parsed.data);
        if (places.length === 10) break;
      }
      return places;
    },
  };
}
