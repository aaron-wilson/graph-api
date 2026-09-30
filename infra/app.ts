import * as cdk from "aws-cdk-lib";
import { parseConfig } from "./config.js";
import { ApiStack } from "./stack.js";
const config = parseConfig(process.env);
const app = new cdk.App();
new ApiStack(app, `Wander${config.PLATFORM_ENV}Graph`, config);
app.synth();
