// Runs under Bun: serves the sibling REST app with its real routes, validation and memory store.
// Only auth is swapped for two fixed test principals so cross-user reads can be exercised.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const root = process.env.REST_API_DIR;
if (!root) throw new Error("REST_API_DIR is required");
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const { createApp } = await load("src/app.ts");
const { parseEnv } = await load("src/config/env.ts");
const { createMemoryStore } = await load("src/store/memory.ts");
const { Unauthorized } = await load("src/auth/port.ts");

const principals = new Map([
  ["Bearer demo", "demo"],
  ["Bearer other", "other"],
]);
const auth = {
  async authenticate(header: string | undefined) {
    const id = principals.get(header ?? "");
    if (!id) throw new Unauthorized("Authentication required");
    return { id };
  },
};
const config = parseEnv({ LOG_LEVEL: "error", RATE_LIMIT_PER_MINUTE: "10000" });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: createApp(config, createMemoryStore(), auth).fetch,
});
process.stdout.write(`${JSON.stringify({ port: server.port })}\n`);
