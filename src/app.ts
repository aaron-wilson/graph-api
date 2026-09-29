import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import type { parseEnv } from "./config/env.js";
import { createTripSchema } from "./graphql/schema.js";
import { deterministicWeather, type WeatherProvider } from "./graphql/resolvers.js";
import { createLogger } from "./lib/utils.js";

export function createApp(
  config: ReturnType<typeof parseEnv>,
  weather: WeatherProvider = deterministicWeather
) {
  const log = createLogger(config.logLevel);
  const yoga = createYoga({
    schema: createTripSchema(weather),
    cors: { origin: config.corsOrigin },
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
