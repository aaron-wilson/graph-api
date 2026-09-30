import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { startTelemetry } from "../src/otel/init.js";
import { createLogger } from "../src/lib/utils.js";

describe("telemetry boundary", () => {
  it("does not create exporters in the default mode", () => {
    expect(startTelemetry(parseEnv({}))).toBeNull();
  });

  it("accepts only an OTLP URL when enabled", () => {
    expect(() => parseEnv({ TELEMETRY_MODE: "otlp" })).toThrow("OTEL_EXPORTER_OTLP_ENDPOINT");
  });

  it("drops unapproved log fields", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createLogger("info")("error", "request_error", { name: "Error", token: "private" });
    createLogger("info")("error", "request_error", { name: "token=private" });
    expect(write.mock.calls.join(" ")).not.toContain("private");
    write.mockRestore();
  });
});

it("marks the root span ERROR for internal resolver failures only", async () => {
  const { NodeSDK, tracing } = await import("@opentelemetry/sdk-node");
  const exporter = new tracing.InMemorySpanExporter();
  const sdk = new NodeSDK({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });
  sdk.start();
  const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const { createApp } = await import("../src/app.js");
  const request = (await import("supertest")).default;
  const app = createApp(parseEnv({}), {
    restFetch: async () => {
      throw new Error("PRIVATE_TELEMETRY_SENTINEL");
    },
  });
  try {
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const failure = await request(app)
      .post("/graphql")
      .set("Authorization", "Bearer demo")
      .send({ query: '{ trip(id: "00000000-0000-4000-8000-000000000001") { id } }' });
    expect(failure.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
    const client = await request(app).post("/graphql").send({ query: "{ trips { nextCursor } }" });
    expect(client.body.errors[0].extensions.code).toBe("UNAUTHENTICATED");
    const spans = exporter.getFinishedSpans().filter((span) => span.name === "http.graph");
    expect(spans.map((span) => span.status.code)).toEqual([2, 0]);
    expect(
      JSON.stringify(
        spans.map((span) => ({
          status: span.status,
          attributes: span.attributes,
          events: span.events,
        }))
      )
    ).not.toContain("PRIVATE_TELEMETRY_SENTINEL");
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await sdk.shutdown();
    write.mockRestore();
  }
});
