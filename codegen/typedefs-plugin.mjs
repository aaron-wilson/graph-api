// Emits the SDL as a runtime string so the server and generated types share one source.
import { printSchema } from "graphql";

export const plugin = (schema) =>
  `\nexport const typeDefs = ${JSON.stringify(printSchema(schema))};\n`;
