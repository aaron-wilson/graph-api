import { afterEach, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
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
  expect(result.body.data.planTrip.activityOptions).toEqual(["Explore museums in Lisbon"]);
  expect(result.body.data.planTrip.currentWeather).toBeTruthy();
  const bad = await request(server)
    .post("/graphql")
    .send({ query: '{ planTrip(city:"", preferences:[]) { itinerary } }' });
  expect(bad.body.errors).toHaveLength(1);
  expect(JSON.stringify(bad.body)).not.toContain("ZodError");
});
