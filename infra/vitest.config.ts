import { fileURLToPath } from "node:url";
const dependency = (name: string) =>
  fileURLToPath(
    new URL(`../../graph-rest-react-stack/platform-cdk/node_modules/${name}`, import.meta.url)
  );
export default {
  envDir: false,
  resolve: {
    alias: [
      { find: /^aws-cdk-lib$/, replacement: dependency("aws-cdk-lib/index.js") },
      { find: "constructs", replacement: dependency("constructs/lib/index.js") },
      { find: "vitest", replacement: dependency("vitest/dist/index.js") },
    ],
  },
  test: { include: ["infra/**/*.test.ts"] },
};
