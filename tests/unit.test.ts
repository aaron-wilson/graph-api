import { expect, it, vi } from "vitest";
import { buildSchema, parse, validate } from "graphql";
import { readFileSync } from "node:fs";
import { createCognitoAuth } from "../src/auth/cognito.js";
import { demoAuth } from "../src/auth/demo.js";
import { selectAuth } from "../src/auth/select.js";
import { parseEnv, summarizeConfig } from "../src/config/env.js";
import { createLogger } from "../src/lib/utils.js";
import { queryLimitRule } from "../src/graphql/limits.js";
import { mockProviders } from "../src/providers/mock.js";
import { createRestClient, type Trip } from "../src/rest/client.js";
import { createTripLoader } from "../src/trips/loader.js";
import { gatherIdeas, planDays, refineDays } from "../src/trips/planner.js";

const ids = () => {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
};
const trip = (id: string, ownerId = "demo"): Trip => ({
  id,
  ownerId,
  city: "Lisbon",
  preferences: { interests: [], pace: "relaxed" },
  days: [],
  share: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  version: 1,
});

it("validates and freezes configuration without exposing invalid values", () => {
  expect(Object.isFrozen(parseEnv({}))).toBe(true);
  expect(() => parseEnv({ PORT: "secret" })).toThrow("PORT");
  expect(() => parseEnv({ CORS_ORIGIN: "secret" })).toThrow("CORS_ORIGIN");
  expect(() => parseEnv({ REST_URL: "secret" })).toThrow("REST_URL");
  expect(() => parseEnv({ MAX_QUERY_DEPTH: "0" })).toThrow("MAX_QUERY_DEPTH");
  expect(() => parseEnv({ ALLOW_INTROSPECTION: "yes" })).toThrow("ALLOW_INTROSPECTION");
  expect(() => parseEnv({ APP_MODE: "live" })).toThrow("Cognito settings");
  expect(parseEnv({}).allowIntrospection).toBe(false);
  expect(parseEnv({ ALLOW_INTROSPECTION: "true" }).allowIntrospection).toBe(true);
});

it("validates selected providers, models and endpoints without echoing values", () => {
  const selected = {
    PROVIDER_LLM: "openai",
    OPENAI_API_KEY: "PRIVATE_KEY_SENTINEL",
    OPENAI_MODEL: "example-model-1.5",
  };
  expect(parseEnv(selected).openaiModel).toBe("example-model-1.5");
  const rejected: [Record<string, string>, string][] = [
    [{ PROVIDER_LLM: "openai", OPENAI_API_KEY: "PRIVATE_KEY_SENTINEL" }, "OPENAI_MODEL"],
    [{ PROVIDER_LLM: "anthropic", ANTHROPIC_MODEL: "example" }, "ANTHROPIC_API_KEY"],
    [{ ...selected, OPENAI_MODEL: "bad model; PRIVATE_KEY_SENTINEL" }, "OPENAI_MODEL"],
    [
      { ...selected, OPENAI_BASE_URL: "http://vendor.example/PRIVATE_KEY_SENTINEL" },
      "OPENAI_BASE_URL",
    ],
    [{ WTTR_URL: "https://user:PRIVATE_KEY_SENTINEL@wttr.example" }, "WTTR_URL"],
    [{ OVERPASS_URL: "ftp://overpass.example/PRIVATE_KEY_SENTINEL" }, "OVERPASS_URL"],
    [{ PROVIDER_WEATHER: "PRIVATE_KEY_SENTINEL" }, "PROVIDER_WEATHER"],
    [
      {
        TELEMETRY_MODE: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://u:PRIVATE_KEY_SENTINEL@c:4318",
      },
      "OTEL_EXPORTER_OTLP_ENDPOINT",
    ],
  ];
  for (const [input, key] of rejected) {
    let message = "";
    try {
      parseEnv(input);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain(key);
    expect(message).not.toContain("PRIVATE_KEY_SENTINEL");
  }
  // Blank optional settings stay valid while their adapter is not selected.
  expect(
    parseEnv({
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      TICKETMASTER_API_KEY: "",
      OPENAI_BASE_URL: "",
    }).providerLlm
  ).toBe("mock");
  expect(parseEnv({ WTTR_URL: "http://127.0.0.1:9000" }).wttrUrl).toBe("http://127.0.0.1:9000");
});

it("summarizes selections without keys, endpoints or identifiers", () => {
  expect(summarizeConfig(parseEnv({}))).toEqual({
    auth: "demo",
    weather: "mock",
    places: "mock",
    events: "mock",
    llm: "mock",
    model: "none",
    telemetry: "off",
  });
  const live = parseEnv({
    APP_MODE: "live",
    COGNITO_USER_POOL_ID: "us-east-1_PRIVATEPOOL",
    COGNITO_CLIENT_ID: "PRIVATE_CLIENT",
    PROVIDER_WEATHER: "wttr",
    PROVIDER_LLM: "anthropic",
    ANTHROPIC_API_KEY: "PRIVATE_KEY_SENTINEL",
    ANTHROPIC_MODEL: "example-model",
    TELEMETRY_MODE: "otlp",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.private:4318",
  });
  const summary = summarizeConfig(live);
  expect(summary).toMatchObject({ auth: "live", weather: "wttr", llm: "anthropic" });
  expect(summary.model).toBe("example-model");
  expect(JSON.stringify(summary)).not.toMatch(/PRIVATE|collector/);
  const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  createLogger("info")("info", "config_summary", { ...summary, apiKey: "PRIVATE_KEY_SENTINEL" });
  const line = write.mock.calls.join(" ");
  write.mockRestore();
  expect(line).toContain('"llm":"anthropic"');
  expect(line).toContain('"model":"example-model"');
  expect(line).not.toContain("PRIVATE");
});

it("selects demo auth only in demo mode and never falls back from Cognito", async () => {
  expect(selectAuth(parseEnv({}))).toBe(demoAuth);
  const live = selectAuth(
    parseEnv({
      APP_MODE: "live",
      COGNITO_USER_POOL_ID: "us-east-1_example",
      COGNITO_CLIENT_ID: "x",
    })
  );
  expect(live).not.toBe(demoAuth);
  await expect(live.authenticate("Bearer demo")).rejects.toThrow("Invalid token");
  expect(await demoAuth.authenticate(null)).toBeNull();
  await expect(demoAuth.authenticate("Bearer other")).rejects.toThrow("Invalid token");
  const cognito = createCognitoAuth("pool", "client", async (token) =>
    token === "good" ? { sub: "user-1" } : token === "nosub" ? {} : Promise.reject(new Error("x"))
  );
  expect(await cognito.authenticate("Bearer good")).toEqual({ id: "user-1" });
  await expect(cognito.authenticate("Bearer nosub")).rejects.toThrow("Invalid token");
  await expect(cognito.authenticate("Bearer bad")).rejects.toThrow("Invalid token");
  await expect(cognito.authenticate("Basic good")).rejects.toThrow("Invalid token");
});

it("plans deterministic days and keeps pinned activities when refining", async () => {
  const ideas = await gatherIdeas(mockProviders, "Lisbon", ["food"]);
  expect(ideas).toEqual(await gatherIdeas(mockProviders, "Lisbon", ["food"]));
  expect(ideas[0]).toBe("Explore food in Lisbon");
  const days = planDays(ideas, "2026-10-30", 3, "balanced", ids());
  expect(days.map((day) => day.date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  for (const day of days) {
    expect(day.activities).toHaveLength(3);
    expect(new Set(day.activities.map((activity) => activity.title)).size).toBe(3);
  }
  const [day] = days;
  const kept = day?.activities[1];
  if (!day || !kept) throw new Error("Missing plan");
  const pinned = { ...kept, pinned: true };
  const refined = refineDays(
    [{ ...day, activities: [pinned] }],
    ["Something new", pinned.title],
    "busy",
    ids()
  );
  expect(refined[0]?.activities[0]).toEqual(pinned);
  expect(refined[0]?.activities.map((activity) => activity.title)).toEqual([
    pinned.title,
    "Something new",
  ]);
});

it("bounds query depth and fragment-expanded cost", () => {
  const schema = buildSchema(readFileSync("schema.graphql", "utf8"));
  const errors = (query: string) =>
    validate(schema, parse(query), [queryLimitRule(4, 100)]).map((error) => error.message);
  expect(errors("{ trips { items { days { activities { id } } } } }")).toEqual([
    "Query depth exceeds 4",
  ]);
  expect(errors("{ trips { items { id city } } }")).toEqual([]);
  expect(errors("{ trips(first: 50) { items { id city } } }")).toEqual(["Query cost exceeds 100"]);
  expect(errors("query($n: Int!) { trips(first: $n) { nextCursor } }")).toEqual([
    "Query cost exceeds 100",
  ]);
  expect(
    errors("fragment F on Trip { id city version } { trips(first: 30) { items { ...F } } }")
  ).toEqual(["Query cost exceeds 100"]);
});

it("costs a variable page size at its request value", () => {
  const schema = buildSchema(readFileSync("schema.graphql", "utf8"));
  // The saved-trips query the UI sends; it must fit the default budget at its page size.
  const saved =
    "query ListTrips($first: Int!) { trips(first: $first) { items { id city version updatedAt days { id date } } nextCursor } }";
  const errors = (query: string, variables?: Record<string, unknown>, maxCost = 500) =>
    validate(schema, parse(query), [queryLimitRule(8, maxCost, variables)]).map(
      (error) => error.message
    );
  expect(errors(saved, { first: 20 })).toEqual([]);
  expect(errors(saved, { first: 100 })).toEqual(["Query cost exceeds 500"]);
  expect(errors(saved)).toEqual(["Query cost exceeds 500"]);
  for (const first of [0, -5, 101, 2.5, "20", null])
    expect(errors(saved, { first })).toEqual(["Query cost exceeds 500"]);
  const defaulted = "query($n: Int = 10) { trips(first: $n) { items { id city } } }";
  expect(errors(defaulted, {}, 100)).toEqual([]);
  expect(errors(defaulted, { n: 50 }, 100)).toEqual(["Query cost exceeds 100"]);
  expect(
    errors(
      "query($n: Int!) { ...Page } fragment Page on Query { trips(first: $n) { items { id city } } }",
      { n: 50 },
      100
    )
  ).toEqual(["Query cost exceeds 100"]);
});

it("bounds repeated fragments and never subtracts invalid page sizes", () => {
  const schema = buildSchema(readFileSync("schema.graphql", "utf8"));
  const queryType = schema.getQueryType();
  if (!queryType) throw new Error("Missing query type");
  const fieldReads = vi.spyOn(queryType, "getFields");
  const errors = (query: string) =>
    validate(schema, parse(query), [queryLimitRule(8, 100)]).map((error) => error.message);
  const dag =
    "{ ...F0 } " +
    Array.from(
      { length: 20 },
      (_, i) => `fragment F${i} on Query { ...F${i + 1} ...F${i + 1} }`
    ).join(" ") +
    " fragment F20 on Query { __typename }";
  expect(errors(dag)).toContain("Query cost exceeds 100");
  expect(fieldReads.mock.calls.length).toBeLessThan(1000);
  fieldReads.mockRestore();
  const siblings = Array.from({ length: 101 }, (_, i) => `f${i}: __typename`).join(" ");
  for (const first of ["-1000", "0", "101"])
    expect(errors(`{ bad: trips(first: ${first}) { nextCursor } ${siblings} }`)).toContain(
      "Query cost exceeds 100"
    );
  expect(
    errors(`query($n: Int = -1000) { bad: trips(first: $n) { nextCursor } ${siblings} }`)
  ).toContain("Query cost exceeds 100");
  expect(errors("{ ...Cycle } fragment Cycle on Query { ...Cycle __typename }")).toEqual([]);
  expect(errors("{ trips { items { days { activities { id } } } } }")).toEqual([]);
});

it("coalesces loads into one REST batch and drops trips owned by someone else", async () => {
  const bodies: unknown[] = [];
  const transport: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      items: [
        trip("00000000-0000-4000-8000-000000000002"),
        trip("00000000-0000-4000-8000-000000000001", "other"),
      ],
    });
  };
  const loader = createTripLoader(
    createRestClient("http://rest", "Bearer demo", 1000, transport),
    "demo"
  );
  const [first, second, again] = await Promise.all([
    loader.load("00000000-0000-4000-8000-000000000001"),
    loader.load("00000000-0000-4000-8000-000000000002"),
    loader.load("00000000-0000-4000-8000-000000000002"),
  ]);
  expect(bodies).toEqual([
    { ids: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"] },
  ]);
  expect(first).toBeNull();
  expect(second?.id).toBe("00000000-0000-4000-8000-000000000002");
  expect(again).toBe(second);
});

it("normalizes REST failures without leaking upstream bodies", async () => {
  const client = (response: () => Promise<Response>) =>
    createRestClient("http://rest", "Bearer demo", 50, () => response());
  const status = async (response: () => Promise<Response>) =>
    client(response)
      .batch([])
      .then(
        () => 200,
        (error: { status: number; message: string }) => {
          expect(error.message).toBe("Trip service request failed");
          return error.status;
        }
      );
  expect(await status(async () => new Response("secret", { status: 409 }))).toBe(409);
  expect(await status(async () => new Response("secret", { status: 500 }))).toBe(502);
  expect(await status(async () => new Response("not json"))).toBe(502);
  expect(await status(async () => Response.json({ items: [{ id: "bad" }] }))).toBe(502);
  expect(await status(async () => new Response("x".repeat(1_000_001)))).toBe(502);
  expect(await status(() => Promise.reject(new Error("ECONNREFUSED secret")))).toBe(502);
  const anonymous = createRestClient("http://rest", null, 50, async () => Response.json({}));
  await expect(anonymous.batch([])).rejects.toMatchObject({ status: 401 });
});

it("streams offline itinerary text that reads as an activity", async () => {
  const text = async (prompt: string) => {
    let joined = "";
    for await (const chunk of mockProviders.llm.stream(prompt)) joined += chunk;
    return joined;
  };
  expect(await text("Plan activities in Lisbon for food, art")).toBe(
    "Start with an unhurried walk through Lisbon, pausing wherever something catches your eye."
  );
  expect(await text("Plan activities in Oslo for")).toContain("through Oslo,");
  expect(await text(`Plan activities in ${"x".repeat(100)} for art`)).toContain(
    ` ${"x".repeat(60)},`
  );
});
