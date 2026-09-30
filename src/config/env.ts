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
  PROVIDER_STREAM_DEADLINE_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  REST_URL: z.string().url().default("http://127.0.0.1:3000"),
  REST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(3000),
  APP_MODE: z.enum(["demo", "live"]).default("demo"),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  MAX_QUERY_DEPTH: z.coerce.number().int().min(1).max(20).default(8),
  MAX_QUERY_COMPLEXITY: z.coerce.number().int().min(1).max(1000).default(100),
  ALLOW_INTROSPECTION: z.enum(["true", "false"]).default("false"),
  TELEMETRY_MODE: z.enum(["off", "otlp"]).default("off"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
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
  if (
    result.data.APP_MODE === "live" &&
    (!result.data.COGNITO_USER_POOL_ID || !result.data.COGNITO_CLIENT_ID)
  )
    throw new Error("Invalid configuration: Cognito settings");
  if (result.data.TELEMETRY_MODE === "otlp" && !result.data.OTEL_EXPORTER_OTLP_ENDPOINT)
    throw new Error("Invalid configuration: OTEL_EXPORTER_OTLP_ENDPOINT");
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
    providerStreamDeadlineMs: result.data.PROVIDER_STREAM_DEADLINE_MS,
    restUrl: result.data.REST_URL,
    restTimeoutMs: result.data.REST_TIMEOUT_MS,
    appMode: result.data.APP_MODE,
    cognitoUserPoolId: result.data.COGNITO_USER_POOL_ID,
    cognitoClientId: result.data.COGNITO_CLIENT_ID,
    maxQueryDepth: result.data.MAX_QUERY_DEPTH,
    maxQueryComplexity: result.data.MAX_QUERY_COMPLEXITY,
    allowIntrospection: result.data.ALLOW_INTROSPECTION === "true",
    telemetryMode: result.data.TELEMETRY_MODE,
    otlpEndpoint: result.data.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
}
