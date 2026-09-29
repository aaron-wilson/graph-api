import type { CodegenConfig } from "@graphql-codegen/cli";

// The checked-in SDL is the only schema source; runtime typeDefs and resolver types are generated.
const config: CodegenConfig = {
  schema: "schema.graphql",
  generates: {
    "src/graphql/generated.ts": {
      plugins: ["typescript", "typescript-resolvers", "./codegen/typedefs-plugin.mjs"],
      config: {
        contextType: "./context.js#GraphContext",
        mappers: { Trip: "../rest/client.js#Trip", SharedTrip: "../rest/client.js#PublicTrip" },
        mapperTypeSuffix: "Record",
        enumsAsTypes: true,
        enumValues: { Pace: { RELAXED: "relaxed", BALANCED: "balanced", BUSY: "busy" } },
        useTypeImports: true,
        useIndexSignature: true,
        avoidOptionals: { field: true, inputValue: false, object: false, defaultValue: false },
      },
    },
  },
};
export default config;
