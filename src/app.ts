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
import { createGenerationManager, type GenerationManager } from "./trips/generations.js";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { incomingContext, recordFailure } from "./otel/operations.js";

export interface AppDeps {
  providers: PlanningProviders;
  auth: AuthPort;
  restFetch: typeof fetch;
  generations: GenerationManager;
}

export function createApp(config: ReturnType<typeof parseEnv>, deps: Partial<AppDeps> = {}) {
  const auth = deps.auth ?? selectAuth(config);
  if (config.appMode === "live" && auth === demoAuth)
    throw new Error("Demo auth is unavailable in live mode");
  const log = createLogger(config.logLevel);
  const generations = deps.generations ?? createGenerationManager();
  const yoga = createYoga({
    schema: tripSchema,
    context: createContextFactory({
      auth,
      providers: deps.providers ?? createProviders(config),
      restUrl: config.restUrl,
      restTimeoutMs: config.restTimeoutMs,
      restFetch: deps.restFetch ?? fetch,
      generations,
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
        if (!toPublicError(error)) {
          trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
          recordFailure("graphql");
          log("error", "graphql_error", { classification: "internal" });
        }
      },
    },
  });
  return createServer((request, response) => {
    const spanContext = incomingContext(
      typeof request.headers.traceparent === "string" ? request.headers.traceparent : undefined
    );
    return context.with(spanContext, () =>
      trace.getTracer("wander-graph").startActiveSpan("http.graph", (span) => {
        const end = () => {
          response.removeListener("finish", end);
          response.removeListener("close", end);
          span.end();
        };
        response.once("finish", end);
        response.once("close", end);
        if (request.url === "/health") {
          // The UI footer probes this cross-origin; without the header the browser hides the 200.
          response.writeHead(200, {
            "content-type": "application/json",
            "access-control-allow-origin": config.corsOrigin,
          });
          response.end(JSON.stringify({ status: "healthy" }));
          return;
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname.startsWith("/generations/") && url.pathname.endsWith("/events")) {
          response.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
          response.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization, Last-Event-ID, traceparent"
          );
          response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          if (request.method === "OPTIONS") {
            response.writeHead(204);
            response.end();
            return;
          }
          if (request.method !== "GET") {
            response.writeHead(405);
            response.end();
            return;
          }
          let id: string;
          try {
            id = decodeURIComponent(url.pathname.slice("/generations/".length, -"/events".length));
          } catch {
            response.writeHead(400);
            response.end();
            return;
          }
          const header = request.headers.authorization ?? null;
          void auth
            .authenticate(header)
            .then((principal) => {
              if (!principal) {
                response.writeHead(401);
                response.end();
                return;
              }
              if (!generations.owns(id, principal.id)) {
                response.writeHead(404);
                response.end();
                return;
              }
              const from = Number(
                request.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0
              );
              response.writeHead(200, {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
                connection: "keep-alive",
              });
              let stop: () => void = () => undefined;
              const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
              heartbeat.unref();
              response.on("close", () => {
                clearInterval(heartbeat);
                stop();
              });
              const result = generations.subscribe(
                id,
                principal.id,
                Number.isSafeInteger(from) && from >= 0 ? from : 0,
                (event) => {
                  response.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
                  if (event.status !== "running") response.end();
                }
              );
              if (!result) {
                clearInterval(heartbeat);
                response.end();
                return;
              }
              stop = result;
            })
            .catch(() => {
              if (!response.headersSent) response.writeHead(401);
              response.end();
            });
          return;
        }
        Promise.resolve(yoga(request, response)).catch((error: unknown) => {
          span.setStatus({ code: SpanStatusCode.ERROR });
          recordFailure("http.graph");
          log("error", "request_error", { name: error instanceof Error ? error.name : "Unknown" });
          if (!response.headersSent)
            response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Internal server error" }));
        });
      })
    );
  });
}
