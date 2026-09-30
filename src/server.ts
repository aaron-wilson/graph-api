import { createApp } from "./app.js";
import type { parseEnv } from "./config/env.js";
import { createLogger } from "./lib/utils.js";

export function startServer(config: ReturnType<typeof parseEnv>) {
  return createApp(config).listen(config.port, () =>
    createLogger(config.logLevel)("info", "server_start", { port: config.port })
  );
}
