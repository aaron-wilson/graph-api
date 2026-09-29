import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import request from "supertest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createApp } from "../../src/app.js";
import { Unauthorized, type AuthPort } from "../../src/auth/port.js";
import { parseEnv } from "../../src/config/env.js";
import { mockProviders } from "../../src/providers/mock.js";

// Requires Bun and a sibling rest-api checkout with installed dependencies (or REST_API_DIR).
const restDir = process.env.REST_API_DIR ?? resolve(import.meta.dirname, "../../../rest-api");
let rest: ChildProcess | undefined;
let graph: Server | undefined;
let restPort = 0;
let calls: { method: string; path: string; auth: string | null; body: unknown }[] = [];

// Mirrors the REST harness principals; GraphQL forwards the same header to REST.
const testAuth: AuthPort = {
  async authenticate(header) {
    if (header === null) return null;
    const id = { "Bearer demo": "demo", "Bearer other": "other" }[header];
    if (!id) throw new Unauthorized("Invalid token");
    return { id };
  },
};
const countingFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = new Headers(init?.headers);
  calls.push({
    method: init?.method ?? "GET",
    path: url.pathname,
    auth: headers.get("authorization"),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  });
  return fetch(input, init);
};

beforeAll(async () => {
  if (!existsSync(resolve(restDir, "src/app.ts")))
    throw new Error(`REST checkout not found at ${restDir}; set REST_API_DIR`);
  const child = spawn("bun", ["run", resolve(import.meta.dirname, "rest-server.ts")], {
    env: { ...process.env, REST_API_DIR: restDir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  rest = child;
  const port = await new Promise<number>((done, fail) => {
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`REST server exited with ${code}`)));
    if (!child.stdout) return fail(new Error("REST server has no stdout"));
    createInterface({ input: child.stdout }).once("line", (line) => {
      done((JSON.parse(line) as { port: number }).port);
    });
  });
  restPort = port;
  const config = parseEnv({ LOG_LEVEL: "error", REST_URL: `http://127.0.0.1:${port}` });
  graph = createApp(config, { auth: testAuth, restFetch: countingFetch });
  await new Promise<void>((done) => graph?.listen(0, "127.0.0.1", done));
}, 20_000);
afterAll(async () => {
  if (graph) await new Promise<void>((done) => graph?.close(() => done()));
  rest?.kill();
});

it("streams ordered generation chunks and persists the completed trip", async () => {
  const slow = createApp(
    parseEnv({ LOG_LEVEL: "error", REST_URL: `http://127.0.0.1:${restPort}` }),
    {
      auth: testAuth,
      restFetch: countingFetch,
      providers: {
        ...mockProviders,
        llm: {
          async *stream(_prompt, signal) {
            // No delay: chunks emitted before the first subscriber must still reach it.
            for (const chunk of ["First ", "second"]) {
              if (signal?.aborted) return;
              yield chunk;
            }
          },
        },
      },
    }
  );
  await new Promise<void>((done) => slow.listen(0, "127.0.0.1", done));
  try {
    const start = await request(slow).post("/graphql").set("Authorization", "Bearer demo").send({
      query:
        'mutation { startCreateGeneration(input: {city:"Oslo", startDate:"2026-10-01", dayCount:1, preferences:{interests:["art"], pace:RELAXED}}) { id status } }',
    });
    const id = start.body.data.startCreateGeneration.id as string;
    const address = slow.address();
    if (!address || typeof address === "string") throw new Error("Missing graph port");
    const url = `http://127.0.0.1:${address.port}/generations/${encodeURIComponent(id)}/events`;
    expect((await fetch(url, { headers: { Authorization: "Bearer other" } })).status).toBe(404);
    const response = await fetch(url, { headers: { Authorization: "Bearer demo" } });
    expect(response.status).toBe(200);
    const frames = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map(
        (frame) =>
          JSON.parse(frame.split("\ndata: ")[1] ?? "null") as {
            seq: number;
            type: string;
            text: string | null;
            tripId: string | null;
          }
      );
    expect(frames.map((frame) => frame.seq)).toEqual(
      [...frames.map((frame) => frame.seq)].sort((a, b) => a - b)
    );
    expect(
      frames
        .filter((frame) => frame.type === "snapshot" || frame.type === "chunk")
        .map((frame) => frame.text)
        .join("")
    ).toBe("First second");
    const tripId = frames.at(-1)?.tripId;
    expect(frames.at(-1)?.type).toBe("completed");
    const trip = await request(slow)
      .post("/graphql")
      .set("Authorization", "Bearer demo")
      .send({ query: `{ trip(id:"${tripId}") { id days { activities { title } } } }` });
    expect(trip.body.data.trip.id).toBe(tripId);
    expect(JSON.stringify(trip.body.data.trip.days)).toContain("First second");
    const replay = await fetch(url, {
      headers: { Authorization: "Bearer demo", "Last-Event-ID": "1" },
    });
    expect(await replay.text()).toContain('"type":"completed"');
  } finally {
    await new Promise<void>((done) => slow.close(() => done()));
  }
});

it("reports fast completion and provider failure through authenticated SSE", async () => {
  if (!graph) throw new Error("GraphQL server not started");
  const started = await gql(
    'mutation { startCreateGeneration(input:{city:"Fast",startDate:"2026-10-01",dayCount:1,preferences:{interests:[],pace:RELAXED}}){id} }'
  );
  const id = (started.data as { startCreateGeneration: { id: string } }).startCreateGeneration.id;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const address = graph.address();
  if (!address || typeof address === "string") throw new Error("Missing graph port");
  const view = await fetch(
    `http://127.0.0.1:${address.port}/generations/${encodeURIComponent(id)}/events`,
    { headers: { Authorization: "Bearer demo" } }
  );
  expect(await view.text()).toContain('"status":"completed"');

  const failed = createApp(
    parseEnv({ LOG_LEVEL: "error", REST_URL: `http://127.0.0.1:${restPort}` }),
    {
      auth: testAuth,
      restFetch: countingFetch,
      providers: {
        ...mockProviders,
        llm: {
          async *stream() {
            yield "";
            throw new Error("vendor failed");
          },
        },
      },
    }
  );
  await new Promise<void>((done) => failed.listen(0, "127.0.0.1", done));
  try {
    calls = [];
    const result = await request(failed).post("/graphql").set("Authorization", "Bearer demo").send({
      query:
        'mutation { startCreateGeneration(input:{city:"Fail",startDate:"2026-10-01",dayCount:1,preferences:{interests:[],pace:RELAXED}}){id} }',
    });
    const failedId = result.body.data.startCreateGeneration.id as string;
    const failedAddress = failed.address();
    if (!failedAddress || typeof failedAddress === "string") throw new Error("Missing graph port");
    const stream = await fetch(
      `http://127.0.0.1:${failedAddress.port}/generations/${encodeURIComponent(failedId)}/events`,
      { headers: { Authorization: "Bearer demo" } }
    );
    expect(await stream.text()).toContain('"status":"failed"');
    expect(calls.some((call) => call.method === "POST" && call.path === "/trips")).toBe(false);
  } finally {
    await new Promise<void>((done) => failed.close(() => done()));
  }
});

it("cancels before the save and keeps a save that already started over HTTP/SSE", async () => {
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writing = false;
  const gatedFetch: typeof fetch = async (input, init) => {
    if (init?.method === "POST" && new URL(String(input)).pathname === "/trips") {
      writing = true;
      await gate;
    }
    return countingFetch(input, init);
  };
  let hold = true;
  const app = createApp(
    parseEnv({ LOG_LEVEL: "error", REST_URL: `http://127.0.0.1:${restPort}` }),
    {
      auth: testAuth,
      restFetch: gatedFetch,
      providers: {
        ...mockProviders,
        llm: {
          async *stream(_prompt, signal) {
            while (hold && !signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 5));
            yield "Planned";
          },
        },
      },
    }
  );
  await new Promise<void>((done) => app.listen(0, "127.0.0.1", done));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("Missing graph port");
  const post = (query: string) =>
    request(app).post("/graphql").set("Authorization", "Bearer demo").send({ query });
  const startQuery =
    'mutation { startCreateGeneration(input:{city:"Bergen",startDate:"2026-10-01",dayCount:1,preferences:{interests:[],pace:RELAXED}}){id} }';
  const events = (id: string) =>
    fetch(`http://127.0.0.1:${address.port}/generations/${encodeURIComponent(id)}/events`, {
      headers: { Authorization: "Bearer demo" },
    });
  try {
    const early = (await post(startQuery)).body.data.startCreateGeneration.id as string;
    const stream = await events(early);
    const cancelled = await post(`mutation { cancelGeneration(id:"${early}") { status } }`);
    expect(cancelled.body.data.cancelGeneration.status).toBe("cancelled");
    expect(await stream.text()).toContain('"type":"cancelled"');
    expect(calls.some((call) => call.method === "POST" && call.path === "/trips")).toBe(false);

    hold = false;
    const late = (await post(startQuery)).body.data.startCreateGeneration.id as string;
    await expect.poll(() => writing).toBe(true);
    const kept = await post(`mutation { cancelGeneration(id:"${late}") { status } }`);
    expect(kept.body.data.cancelGeneration.status).toBe("running");
    const done = events(late);
    release();
    const final = (await (await done).text()).trim().split("\n\n").at(-1) ?? "";
    const event = JSON.parse(final.split("data: ")[1] ?? "null") as {
      type: string;
      tripId: string;
    };
    expect(event.type).toBe("completed");
    const trip = await post(`{ trip(id:"${event.tripId}") { id } }`);
    expect(trip.body.data.trip.id).toBe(event.tripId);
  } finally {
    release();
    await new Promise<void>((done) => app.close(() => done()));
  }
});
beforeEach(() => {
  calls = [];
});

async function gql(query: string, auth: string | null = "Bearer demo") {
  if (!graph) throw new Error("GraphQL server not started");
  const call = request(graph).post("/graphql");
  if (auth) call.set("Authorization", auth);
  const response = await call.send({ query });
  return response.body as {
    data?: Record<string, never>;
    errors?: { message: string; extensions: { code: string } }[];
  };
}
async function createTrip(auth = "Bearer demo", city = "Lisbon") {
  const result = await gql(
    `mutation { createTrip(input: { city: "${city}", startDate: "2026-10-01", dayCount: 2,
      preferences: { interests: ["food"], pace: RELAXED } }) {
        id ownerId city version preferences { interests pace }
        days { id date activities { id title pinned } } share { token } } }`,
    auth
  );
  if (!result.data) throw new Error(JSON.stringify(result.errors));
  return result.data.createTrip as {
    id: string;
    version: number;
    days: { date: string; activities: { id: string; title: string; pinned: boolean }[] }[];
  } & Record<string, unknown>;
}

it("creates, lists and reads planned trips through REST", async () => {
  const trip = await createTrip();
  expect(trip).toMatchObject({
    ownerId: "demo",
    city: "Lisbon",
    version: 1,
    preferences: { interests: ["food"], pace: "RELAXED" },
    share: null,
  });
  expect(trip.days.map((day) => day.date)).toEqual(["2026-10-01", "2026-10-02"]);
  expect(trip.days[0]?.activities.map((activity) => activity.title)).toEqual([
    "Explore food in Lisbon",
    "Visit Central Lisbon Museum",
  ]);
  const listed = await gql("{ trips(first: 10) { items { id city } nextCursor } }");
  expect(listed.data?.trips).toMatchObject({
    items: expect.arrayContaining([{ id: trip.id, city: "Lisbon" }]),
  });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /trips", "GET /trips"]);
});

it("batches every trip read in one request into a single REST call", async () => {
  const [a, b, c] = [await createTrip(), await createTrip(), await createTrip()];
  calls = [];
  const missing = "00000000-0000-4000-8000-00000000abcd";
  const result = await gql(`{
    a: trip(id: "${a.id}") { id } b: trip(id: "${b.id}") { id }
    c: trip(id: "${c.id}") { id } again: trip(id: "${a.id}") { city } missing: trip(id: "${missing}") { id }
  }`);
  expect(result.errors).toBeUndefined();
  expect(result.data).toMatchObject({
    a: { id: a.id },
    b: { id: b.id },
    c: { id: c.id },
    missing: null,
  });
  // Measured: five trip fields (four distinct IDs) cost one REST request.
  expect(calls).toEqual([
    {
      method: "POST",
      path: "/trips/batch",
      auth: "Bearer demo",
      body: { ids: [a.id, b.id, c.id, missing] },
    },
  ]);
});

it("keeps loader caches per caller and hides other users' trips", async () => {
  const mine = await createTrip("Bearer demo");
  const theirs = await createTrip("Bearer other", "Kyoto");
  calls = [];
  const [asDemo, asOther] = await Promise.all([
    gql(`{ mine: trip(id: "${mine.id}") { id } theirs: trip(id: "${theirs.id}") { id } }`),
    gql(
      `{ mine: trip(id: "${mine.id}") { id } theirs: trip(id: "${theirs.id}") { id } }`,
      "Bearer other"
    ),
  ]);
  expect(asDemo.data).toEqual({ mine: { id: mine.id }, theirs: null });
  expect(asOther.data).toEqual({ mine: null, theirs: { id: theirs.id } });
  expect(calls.map((call) => call.auth).sort()).toEqual(["Bearer demo", "Bearer other"]);
});

it("refreshes cached trips after mutations within one request", async () => {
  const trip = await createTrip();
  const [first] = trip.days[0]?.activities ?? [];
  if (!first) throw new Error("Missing activity");
  calls = [];
  const result = await gql(`mutation {
    pin: pinActivity(input: { tripId: "${trip.id}", version: 1, activityId: "${first.id}", pinned: true }) { version }
    refine: refineTrip(input: { tripId: "${trip.id}", version: 2, preferences: { interests: ["art"], pace: BUSY } }) {
      version preferences { pace } days { activities { title pinned } } }
    share: shareTrip(input: { tripId: "${trip.id}", version: 3 }) { version share { token expiresAt } }
  }`);
  expect(result.errors).toBeUndefined();
  const data = result.data as unknown as {
    refine: { version: number; days: { activities: { title: string; pinned: boolean }[] }[] };
    share: { version: number; share: { token: string } };
  };
  expect(data.refine.version).toBe(3);
  expect(data.refine.days[0]?.activities[0]).toEqual({ title: first.title, pinned: true });
  expect(data.refine.days[0]?.activities).toHaveLength(4);
  expect(data.share.version).toBe(4);
  // The pin response primed the loader, so refine read no stale copy; share cleared and reloaded.
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    `POST /trips/${trip.id}/pin`,
    `PATCH /trips/${trip.id}`,
    `POST /trips/${trip.id}/share`,
    "POST /trips/batch",
  ]);
  const shared = await gql(
    `{ sharedTrip(ownerId: "demo", tripId: "${trip.id}", token: "${data.share.share.token}") { id city days { id } } }`,
    null
  );
  expect(shared.data).toMatchObject({ sharedTrip: { id: trip.id, city: "Lisbon" } });
  const guessed = await gql(
    `{ sharedTrip(ownerId: "demo", tripId: "${trip.id}", token: "${"x".repeat(32)}") { id } }`,
    null
  );
  expect(guessed.data).toEqual({ sharedTrip: null });
});

it("maps REST conflicts, missing trips and rejected edits to client errors", async () => {
  const trip = await createTrip();
  const [first, second] = trip.days[0]?.activities ?? [];
  if (!first || !second) throw new Error("Missing activities");
  const stale = await gql(`mutation { pinActivity(input: { tripId: "${trip.id}", version: 9,
    activityId: "${first.id}", pinned: true }) { id } }`);
  expect(stale.errors?.[0]).toMatchObject({
    message: "Trip version conflict",
    extensions: { code: "CONFLICT" },
  });
  const missing =
    await gql(`mutation { refineTrip(input: { tripId: "00000000-0000-4000-8000-00000000dead",
    version: 1 }) { id } }`);
  expect(missing.errors?.[0]?.extensions.code).toBe("NOT_FOUND");
  const foreign = await gql(
    `mutation { swapActivity(input: { tripId: "${trip.id}", version: 1,
    activityId: "${second.id}", title: "Hijack" }) { id } }`,
    "Bearer other"
  );
  expect(foreign.errors?.[0]?.extensions.code).toBe("NOT_FOUND");
  await gql(`mutation { pinActivity(input: { tripId: "${trip.id}", version: 1,
    activityId: "${second.id}", pinned: true }) { id } }`);
  const pinned = await gql(`mutation { swapActivity(input: { tripId: "${trip.id}", version: 2,
    activityId: "${second.id}", title: "Replacement" }) { id } }`);
  expect(pinned.errors?.[0]).toMatchObject({
    message: "Invalid input",
    extensions: { code: "BAD_USER_INPUT" },
  });
});
