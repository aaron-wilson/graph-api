import { expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { createResolvers, deterministicWeather } from "../src/graphql/resolvers.js";

it("validates and freezes configuration without exposing invalid values", () => {
  expect(Object.isFrozen(parseEnv({}))).toBe(true);
  expect(() => parseEnv({ PORT: "secret" })).toThrow("PORT");
  expect(() => parseEnv({ CORS_ORIGIN: "secret" })).toThrow("CORS_ORIGIN");
});
it("uses injected weather and keeps the demo provider deterministic", async () => {
  const resolver = createResolvers({ current: async () => "Sunny" }).Query.planTrip;
  expect((await resolver(null, { city: "Rome", preferences: [] })).currentWeather).toBe("Sunny");
  expect(await deterministicWeather.current("Rome")).toBe(
    await deterministicWeather.current("Rome")
  );
});
