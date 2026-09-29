import { expect, it } from "vitest";
import { buildSchema, parse, validate } from "graphql";
import { readFileSync } from "node:fs";
import { createCognitoAuth } from "../src/auth/cognito.js";
import { demoAuth } from "../src/auth/demo.js";
import { selectAuth } from "../src/auth/select.js";
import { parseEnv } from "../src/config/env.js";
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
