import "dotenv/config";
import { parseEnv } from "./config/env.js";
import { startTelemetry } from "./otel/init.js";

const config = parseEnv(process.env);
const sdk = startTelemetry(config);
const { startServer } = await import("./server.js");
startServer(config);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (!sdk) process.exit(0);
    else void sdk.shutdown().finally(() => process.exit(0));
  });
}
