import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import type { parseEnv } from "./config/env.js";
import { demoAuth } from "./auth/demo.js";
import type { AuthPort } from "./auth/port.js";
import { selectAuth } from "./auth/select.js";
import { createContextFactory } from "./graphql/context.js";
import { maskGraphError, toPublicError } from "./graphql/errors.js";
import { queryLimits } from "./graphql/limits.js";
import { tripSchema } from "./graphql/schema.js";
import { createProviders } from "./providers/index.js";
import type { PlanningProviders } from "./providers/port.js";
import { createLogger } from "./lib/utils.js";

export interface AppDeps {
  providers: PlanningProviders;
  auth: AuthPort;
  restFetch: typeof fetch;
}

export function createApp(config: ReturnType<typeof parseEnv>, deps: Partial<AppDeps> = {}) {
  const auth = deps.auth ?? selectAuth(config);
  if (config.appMode === "live" && auth === demoAuth)
    throw new Error("Demo auth is unavailable in live mode");
  const log = createLogger(config.logLevel);
  const yoga = createYoga({
    schema: tripSchema,
    context: createContextFactory({
      auth,
      providers: deps.providers ?? createProviders(config),
      restUrl: config.restUrl,
      restTimeoutMs: config.restTimeoutMs,
      restFetch: deps.restFetch ?? fetch,
    }),
    plugins: [
      queryLimits({
        maxDepth: config.maxQueryDepth,
        maxCost: config.maxQueryComplexity,
        allowIntrospection: config.allowIntrospection,
      }),
    ],
    graphiql: config.allowIntrospection,
    cors: { origin: config.corsOrigin },
    maskedErrors: {
      isDev: false,
      maskError: maskGraphError,
    },
    logging: {
      debug: () => log("debug", "graphql_debug"),
      info: () => log("info", "graphql_info"),
      warn: () => log("warn", "graphql_warning"),
      // Yoga reports every remapped error here; client errors are expected and not logged.
      error: (error: unknown) => {
        if (!toPublicError(error)) log("error", "graphql_error", { classification: "internal" });
      },
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
