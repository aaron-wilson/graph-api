import { createSchema } from "graphql-yoga";
import type { GraphContext } from "./context.js";
import { typeDefs } from "./generated.js";
import { resolvers } from "./resolvers.js";

export const tripSchema = createSchema<GraphContext>({ typeDefs, resolvers });
