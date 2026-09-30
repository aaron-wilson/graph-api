import "dotenv/config";
import { parseEnv } from "./config/env.js";
import { startTelemetry } from "./otel/init.js";

const config = parseEnv(process.env);
const sdk = startTelemetry(config);
await import("./server.js");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void sdk?.shutdown().finally(() => process.exit(0));
  });
}
