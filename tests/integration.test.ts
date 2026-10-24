import { afterEach, expect, it, vi } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { GraphQLError } from "graphql";
import { createApp, type AppDeps } from "../src/app.js";
import { demoAuth } from "../src/auth/demo.js";
import { parseEnv } from "../src/config/env.js";
import { mockProviders } from "../src/providers/mock.js";
import { createGenerationManager } from "../src/trips/generations.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});
// No REST server listens here; any call that reaches REST fails as a connection error.
const offlineRest: typeof fetch = () => Promise.reject(new Error("REST_PRIVATE_SENTINEL"));
async function start(env: Record<string, string> = {}, deps: Partial<AppDeps> = {}) {
  server = createApp(parseEnv({ LOG_LEVEL: "error", ...env }), { restFetch: offlineRest, ...deps });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return server;
}
const create = `mutation {
  createTrip(input: { city: "Rome", startDate: "2026-10-01", dayCount: 1,
    preferences: { interests: [], pace: RELAXED } }) { id }
}`;

it("serves health, rejects the retired query and guards introspection", async () => {
  const api = await start();
  const health = await request(api).get("/health");
  expect(health.body.status).toBe("healthy");
  expect(health.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
  const retired = await request(api)
    .post("/graphql")
    .send({ query: '{ planTrip(city:"Rome", preferences:[]) { itinerary } }' });
  expect(retired.body.errors[0].message).toContain('Cannot query field "planTrip"');
  const introspect = await request(api)
    .post("/graphql")
    .send({ query: "{ __schema { types { name } } }" });
  expect(introspect.body.errors[0].message).toContain("introspection");
  server?.close();
  const open = await start({ ALLOW_INTROSPECTION: "true" });
  const allowed = await request(open)
    .post("/graphql")
    .send({ query: '{ __type(name: "Trip") { name } }' });
  expect(allowed.body.data.__type.name).toBe("Trip");
});

it("enforces depth and cost limits before execution", async () => {
  const restFetch = vi.fn(offlineRest);
  const api = await start({ MAX_QUERY_DEPTH: "3", MAX_QUERY_COMPLEXITY: "100" }, { restFetch });
  const deep = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({ query: "{ trips { items { days { id } } } }" });
  expect(deep.body.errors[0]).toMatchObject({
    message: "Query depth exceeds 3",
    extensions: { code: "QUERY_TOO_COMPLEX" },
  });
  const costly = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({ query: "{ trips(first: 100) { items { id city } } }" });
  expect(costly.body.errors[0].message).toBe("Query cost exceeds 100");
  const padded = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({
      query: `{ bad: trips(first: -1000) { nextCursor } ${Array.from({ length: 101 }, (_, i) => `f${i}: __typename`).join(" ")} }`,
    });
  expect(padded.body.errors[0].message).toBe("Query cost exceeds 100");
  const dag =
    "{ ...F0 } " +
    Array.from(
      { length: 20 },
      (_, i) => `fragment F${i} on Query { ...F${i + 1} ...F${i + 1} }`
    ).join(" ") +
    " fragment F20 on Query { __typename }";
  const repeated = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({ query: dag });
  expect(repeated.body.errors[0].message).toBe("Query cost exceeds 100");
  const paged = "query($first: Int!) { trips(first: $first) { items { id city } } }";
  // The same document is costed per request, so a cached validation cannot admit a larger page.
  for (const first of [100, 20, 100]) {
    const response = await request(api)
      .post("/graphql")
      .set("Authorization", "Bearer demo")
      .send({ query: paged, variables: { first } });
    if (first === 100) expect(response.body.errors[0].message).toBe("Query cost exceeds 100");
    else expect(response.body.errors[0].extensions.code).not.toBe("QUERY_TOO_COMPLEX");
  }
  expect(restFetch).toHaveBeenCalledTimes(1);
});

it("lists saved trips with the default limits and a variable page size", async () => {
  const restFetch = vi.fn<typeof fetch>(async () => Response.json({ items: [], nextCursor: null }));
  const api = await start({}, { restFetch });
  const response = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({
      query:
        "query ListTrips($first: Int!) { trips(first: $first) { items { id city version updatedAt days { id date } } nextCursor } }",
      variables: { first: 20 },
    });
  expect(response.body).toEqual({ data: { trips: { items: [], nextCursor: null } } });
  expect(String(restFetch.mock.calls[0]?.[0])).toContain("/trips?limit=20");
  // The browser client sends short queries as GET with JSON-encoded variables.
  const viaGet = await request(api)
    .get("/graphql")
    .set("Authorization", "Bearer demo")
    .query({
      query: "query ListTrips($first: Int!) { trips(first: $first) { items { id } nextCursor } }",
      operationName: "ListTrips",
      variables: JSON.stringify({ first: 20 }),
    });
  expect(viaGet.body).toEqual({ data: { trips: { items: [], nextCursor: null } } });
  const oversized = await request(api)
    .get("/graphql")
    .set("Authorization", "Bearer demo")
    .query({
      query: "query($first: Int!) { trips(first: $first) { items { id city version updatedAt } } }",
      variables: JSON.stringify({ first: 100 }),
    });
  expect(oversized.body.errors[0].message).toBe("Query cost exceeds 500");
});

it("separates anonymous, invalid and valid callers", async () => {
  const api = await start();
  const invalid = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer forged")
    .send({ query: "{ trips { nextCursor } }" });
  expect(invalid.status).toBe(401);
  expect(invalid.body.errors[0]).toMatchObject({ extensions: { code: "UNAUTHENTICATED" } });
  const anonymous = await request(api).post("/graphql").send({ query: "{ trips { nextCursor } }" });
  expect(anonymous.body.errors[0]).toMatchObject({
    message: "Authentication required",
    extensions: { code: "UNAUTHENTICATED" },
  });
  const badId = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({ query: '{ trip(id: "not-a-uuid") { id } }' });
  expect(badId.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
  expect(() =>
    createApp(
      parseEnv({
        APP_MODE: "live",
        COGNITO_USER_POOL_ID: "us-east-1_example",
        COGNITO_CLIENT_ID: "x",
      }),
      { auth: demoAuth }
    )
  ).toThrow("Demo auth is unavailable in live mode");
});

it("masks REST outages and provider errors that resemble input errors", async () => {
  const api = await start(
    {},
    {
      providers: {
        ...mockProviders,
        weather: {
          current: async () => {
            throw new GraphQLError("Invalid input", { extensions: { code: "BAD_USER_INPUT" } });
          },
        },
      },
    }
  );
  const failed = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({ query: create });
  expect(failed.body.errors[0]).toMatchObject({
    message: "Unexpected error.",
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  });
  server?.close();
  const outage = await start();
  const down = await request(outage)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({ query: '{ trip(id: "00000000-0000-4000-8000-000000000001") { id } }' });
  expect(down.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
  expect(JSON.stringify(down.body)).not.toContain("REST_PRIVATE_SENTINEL");
});

it("masks failures in development and logs only safe structured events", async () => {
  const previousEnv = process.env.NODE_ENV;
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.env.NODE_ENV = "development";
  try {
    const api = await start(
      {},
      {
        providers: {
          ...mockProviders,
          weather: {
            current: async () => {
              throw new Error("REVIEW_PRIVATE_SENTINEL");
            },
          },
        },
      }
    );
    const badInput = await request(api)
      .post("/graphql")
      .set("Authorization", "Bearer demo")
      .send({ query: create.replace('"Rome"', '""') });
    expect(badInput.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
    expect(stderr).not.toHaveBeenCalled();
    const failed = await request(api)
      .post("/graphql")
      .set("Authorization", "Bearer demo")
      .send({ query: create });
    const body = JSON.stringify(failed.body);
    const logs = [...stderr.mock.calls, ...stdout.mock.calls]
      .map((call) => String(call[0]))
      .join("");
    expect(body).not.toContain("REVIEW_PRIVATE_SENTINEL");
    expect(body).not.toContain("originalError");
    expect(failed.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
    expect(logs).not.toContain("REVIEW_PRIVATE_SENTINEL");
    expect(logs).not.toContain("stack");
    const events = stderr.mock.calls.map((call) => JSON.parse(String(call[0])) as object);
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

it("rejects invalid or missing generation targets before taking a slot", async () => {
  const generations = createGenerationManager();
  const emptyBatch: typeof fetch = async () =>
    new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
    });
  const api = await start({}, { generations, restFetch: emptyBatch });
  const invalid = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({
      query: `mutation { startCreateGeneration(input: { city: " ", startDate: "2026-10-01",
        dayCount: 1, preferences: { interests: [], pace: RELAXED } }) { id } }`,
    });
  expect(invalid.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
  const foreign = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({
      query: `mutation { startRefineGeneration(input: {
        tripId: "00000000-0000-4000-8000-000000000009", version: 1 }) { id } }`,
    });
  expect(foreign.body.errors[0].extensions.code).toBe("NOT_FOUND");
  expect(generations.size()).toBe(0);
});

it("maps a full generation ledger to RATE_LIMITED", async () => {
  const generations = createGenerationManager();
  const hold = () => new Promise<never>(() => undefined);
  for (const target of ["a", "b", "c"]) generations.start("demo", `demo:${target}`, hold);
  const api = await start({}, { generations });
  const limited = await request(api)
    .post("/graphql")
    .set("Authorization", "Bearer demo")
    .send({
      query: `mutation { startCreateGeneration(input: { city: "Rome", startDate: "2026-10-01",
        dayCount: 1, preferences: { interests: [], pace: RELAXED } }) { id } }`,
    });
  expect(limited.body.errors[0]).toMatchObject({
    message: "Too many active generations",
    extensions: { code: "RATE_LIMITED" },
  });
});
