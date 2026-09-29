import { createServer } from "node:http";
import { createYoga, maskError } from "graphql-yoga";
import type { parseEnv } from "./config/env.js";
import { createTripSchema } from "./graphql/schema.js";
import {
  deterministicWeather,
  isPlanTripInputError,
  type WeatherProvider,
} from "./graphql/resolvers.js";
import { createLogger } from "./lib/utils.js";

export function createApp(
  config: ReturnType<typeof parseEnv>,
  weather: WeatherProvider = deterministicWeather
) {
  const log = createLogger(config.logLevel);
  const yoga = createYoga({
    schema: createTripSchema(weather),
    cors: { origin: config.corsOrigin },
    maskedErrors: {
      isDev: false,
      maskError: (error, message, isDev) => {
        if (error instanceof Error && isPlanTripInputError(error)) return error;
        return maskError(error, message, isDev);
      },
    },
    logging: {
      debug: () => log("debug", "graphql_debug"),
      info: () => log("info", "graphql_info"),
      warn: () => log("warn", "graphql_warning"),
      error: () => log("error", "graphql_error", { classification: "internal" }),
    },
  });
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "healthy" }));
      return;
    }
    Promise.resolve(yoga(request, response)).catch((error: unknown) => {
      log("error", "request_error", { name: error instanceof Error ? error.name : "Unknown" });
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Internal server error" }));
    });
  });
}
