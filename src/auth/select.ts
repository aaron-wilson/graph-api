import type { parseEnv } from "../config/env.js";
import { createCognitoAuth } from "./cognito.js";
import { demoAuth } from "./demo.js";

export function selectAuth(config: ReturnType<typeof parseEnv>) {
  if (config.appMode === "demo") return demoAuth;
  if (!config.cognitoUserPoolId || !config.cognitoClientId)
    throw new Error("Cognito settings required");
  return createCognitoAuth(config.cognitoUserPoolId, config.cognitoClientId);
}
