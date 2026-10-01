import { z } from "zod";

/** A vendor endpoint: HTTPS without embedded credentials, or plain HTTP to this machine. */
const vendorUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, "must be HTTPS without credentials");
/** A collector or service origin on a private network; never carries credentials. */
const plainUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "must be an HTTP(S) URL without credentials");
const modelName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/);

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
  WTTR_URL: vendorUrl.default("https://wttr.in"),
  OVERPASS_URL: vendorUrl.default("https://overpass-api.de/api/interpreter"),
  TICKETMASTER_URL: vendorUrl.default("https://app.ticketmaster.com/discovery/v2/events.json"),
  TICKETMASTER_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: modelName.optional(),
  OPENAI_BASE_URL: vendorUrl.optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: modelName.optional(),
  ANTHROPIC_BASE_URL: vendorUrl.optional(),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  PROVIDER_STREAM_DEADLINE_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  REST_URL: plainUrl.default("http://127.0.0.1:3000"),
  REST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(3000),
  APP_MODE: z.enum(["demo", "live"]).default("demo"),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  MAX_QUERY_DEPTH: z.coerce.number().int().min(1).max(20).default(8),
  MAX_QUERY_COMPLEXITY: z.coerce.number().int().min(1).max(10000).default(500),
  ALLOW_INTROSPECTION: z.enum(["true", "false"]).default("false"),
  TELEMETRY_MODE: z.enum(["off", "otlp"]).default("off"),
  OTEL_EXPORTER_OTLP_ENDPOINT: plainUrl.optional(),
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
export type GraphConfig = ReturnType<typeof parseEnv>;

/**
 * The selections this process runs with, safe to log: adapter names, modes and the selected
 * model only. It never includes a key, token, endpoint or identifier.
 */
export function summarizeConfig(config: GraphConfig) {
  return {
    auth: config.appMode,
    weather: config.providerWeather,
    places: config.providerPlaces,
    events: config.providerEvents,
    llm: config.providerLlm,
    model:
      (config.providerLlm === "openai"
        ? config.openaiModel
        : config.providerLlm === "anthropic"
          ? config.anthropicModel
          : undefined) ?? "none",
    telemetry: config.telemetryMode,
  };
}
