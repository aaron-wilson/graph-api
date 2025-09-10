import "dotenv/config";
import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { schema } from "../src/graphql/schema";
import { logger } from "../src/lib/utils.js";

// Create a Yoga instance with a GraphQL schema
const yoga = createYoga({ schema });

// Hook Yoga into an HTTP server
const server = createServer(yoga);

// Start server
server.listen(4000, () => {
  logger.info("GraphQL server started", {
    port: 4000,
    endpoint: "http://localhost:4000/graphql",
  });
});
