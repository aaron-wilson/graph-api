import { z } from "zod";
import { getJson, type HttpTransport } from "./http.js";
import { citySchema, placeSchema, type PlacesProvider, ProviderError } from "./port.js";

const responseSchema = z.object({
  elements: z
    .array(
      z.object({
        tags: z.object({ name: z.string().optional(), tourism: z.string().optional() }).optional(),
      })
    )
    .max(100),
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
      const places = raw.elements
        .filter((item) => item.tags?.name)
        .slice(0, 10)
        .map((item) => ({
          name: item.tags?.name ?? "",
          category: item.tags?.tourism ?? "attraction",
        }));
      const parsed = z.array(placeSchema).safeParse(places);
      if (!parsed.success) throw new ProviderError("invalid_response");
      return parsed.data;
    },
  };
}
