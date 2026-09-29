import { afterEach, expect, it, vi } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { GraphQLError } from "graphql";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { mockProviders } from "../src/providers/mock.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});
it("masks provider errors even when they resemble input errors", async () => {
  server = createApp(parseEnv({ LOG_LEVEL: "error" }), {
    ...mockProviders,
    weather: {
      current: async () => {
        throw new GraphQLError("Invalid planTrip input", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      },
    },
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const failed = await request(server)
    .post("/graphql")
    .send({ query: '{ planTrip(city:"Rome", preferences:[]) { itinerary } }' });
  expect(failed.body.errors[0].message).toBe("Unexpected error.");
  expect(failed.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
});
it("serves health and a deterministic query over HTTP", async () => {
  server = createApp(parseEnv({}));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  expect((await request(server).get("/health")).body.status).toBe("healthy");
  const result = await request(server).post("/graphql").send({
    query:
      '{ planTrip(city:"Lisbon", preferences:["museums"]) { currentWeather activityOptions itinerary } }',
  });
  expect(result.status).toBe(200);
  expect(result.body.data.planTrip.activityOptions).toContain("Explore museums in Lisbon");
  expect(result.body.data.planTrip.currentWeather).toBeTruthy();
  const bad = await request(server)
    .post("/graphql")
    .send({ query: '{ planTrip(city:"", preferences:[]) { itinerary } }' });
  expect(bad.body.errors).toHaveLength(1);
  expect(bad.body.errors[0]).toMatchObject({
    message: "Invalid planTrip input",
    extensions: { code: "BAD_USER_INPUT" },
  });
  expect(JSON.stringify(bad.body)).not.toContain("ZodError");
});
it("masks provider failures in development and logs only safe structured events", async () => {
  const previousEnv = process.env.NODE_ENV;
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.env.NODE_ENV = "development";
  try {
    server = createApp(parseEnv({ LOG_LEVEL: "error" }), {
      ...mockProviders,
      weather: {
        current: async () => {
          throw new Error("REVIEW_PRIVATE_SENTINEL");
        },
      },
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const badInput = await request(server)
      .post("/graphql")
      .send({ query: '{ planTrip(city:"", preferences:[]) { itinerary } }' });
    expect(badInput.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
    expect(stderr).not.toHaveBeenCalled();
    const failed = await request(server)
      .post("/graphql")
      .send({ query: '{ planTrip(city:"Rome", preferences:[]) { itinerary } }' });
    const body = JSON.stringify(failed.body);
    const logs = [...stderr.mock.calls, ...stdout.mock.calls]
      .map((call) => String(call[0]))
      .join("");
    expect(body).not.toContain("REVIEW_PRIVATE_SENTINEL");
    expect(body).not.toContain("originalError");
    expect(failed.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
    expect(logs).not.toContain("REVIEW_PRIVATE_SENTINEL");
    expect(logs).not.toContain("stack");
    const events = stderr.mock.calls.map(
      (call) =>
        JSON.parse(String(call[0])) as { level: string; event: string; classification?: string }
    );
    expect(events).toEqual([
      { level: "error", event: "graphql_error", classification: "internal" },
    ]);
    expect(stdout).not.toHaveBeenCalled();
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    stderr.mockRestore();
    stdout.mockRestore();
  }
});
