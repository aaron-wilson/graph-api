import { createApp } from "./app.js";
import { summarizeConfig, type GraphConfig } from "./config/env.js";
import { createLogger } from "./lib/utils.js";

export function startServer(config: GraphConfig) {
  const log = createLogger(config.logLevel);
  log("info", "config_summary", summarizeConfig(config));
  return createApp(config).listen(config.port, () =>
    log("info", "server_start", { port: config.port })
  );
}
