import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z
    .string()
    .url()
    .refine((value) => {
      try {
        return new URL(value).origin === value;
      } catch {
        return false;
      }
    }, "must be an origin")
    .default("http://localhost:3001"),
  PROVIDER_WEATHER: z.enum(["mock", "wttr"]).default("mock"),
  PROVIDER_PLACES: z.enum(["mock", "overpass"]).default("mock"),
  PROVIDER_EVENTS: z.enum(["mock", "ticketmaster"]).default("mock"),
  PROVIDER_LLM: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  WTTR_URL: z.string().url().default("https://wttr.in"),
  OVERPASS_URL: z.string().url().default("https://overpass-api.de/api/interpreter"),
  TICKETMASTER_URL: z
    .string()
    .url()
    .default("https://app.ticketmaster.com/discovery/v2/events.json"),
  TICKETMASTER_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
});
export function parseEnv(input: Record<string, string | undefined>) {
  const result = schema.safeParse(
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value === "" ? undefined : value])
    )
  );
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  if (result.data.PROVIDER_EVENTS === "ticketmaster" && !result.data.TICKETMASTER_API_KEY)
    throw new Error("Invalid configuration: TICKETMASTER_API_KEY");
  if (
    result.data.PROVIDER_LLM === "openai" &&
    (!result.data.OPENAI_API_KEY || !result.data.OPENAI_MODEL)
  )
    throw new Error("Invalid configuration: OPENAI_API_KEY, OPENAI_MODEL");
  if (
    result.data.PROVIDER_LLM === "anthropic" &&
    (!result.data.ANTHROPIC_API_KEY || !result.data.ANTHROPIC_MODEL)
  )
    throw new Error("Invalid configuration: ANTHROPIC_API_KEY, ANTHROPIC_MODEL");
  return Object.freeze({
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    corsOrigin: result.data.CORS_ORIGIN,
    providerWeather: result.data.PROVIDER_WEATHER,
    providerPlaces: result.data.PROVIDER_PLACES,
    providerEvents: result.data.PROVIDER_EVENTS,
    providerLlm: result.data.PROVIDER_LLM,
    wttrUrl: result.data.WTTR_URL,
    overpassUrl: result.data.OVERPASS_URL,
    ticketmasterUrl: result.data.TICKETMASTER_URL,
    ticketmasterApiKey: result.data.TICKETMASTER_API_KEY,
    openaiApiKey: result.data.OPENAI_API_KEY,
    openaiModel: result.data.OPENAI_MODEL,
    openaiBaseUrl: result.data.OPENAI_BASE_URL,
    anthropicApiKey: result.data.ANTHROPIC_API_KEY,
    anthropicModel: result.data.ANTHROPIC_MODEL,
    anthropicBaseUrl: result.data.ANTHROPIC_BASE_URL,
    providerTimeoutMs: result.data.PROVIDER_TIMEOUT_MS,
  });
}
