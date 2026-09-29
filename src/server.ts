import "dotenv/config";
import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./lib/utils.js";

const config = parseEnv(process.env);
createApp(config).listen(config.port, () =>
  createLogger(config.logLevel)("info", "server_start", { port: config.port })
);
