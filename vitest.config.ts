import { defineConfig } from "vitest/config";
export default defineConfig({
  // Node loads graphql's CommonJS entry for both the app and Yoga; Vite would otherwise pick its
  // ESM build for app source, creating two graphql realms that reject each other's types.
  resolve: { alias: [{ find: /^graphql$/, replacement: "graphql/index.js" }] },
  test: { include: ["tests/**/*.test.ts"] },
});
