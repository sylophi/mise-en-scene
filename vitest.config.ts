import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/src/**/*.test.{ts,tsx}"],
    // core is headless (node); React tests opt into jsdom via a per-file
    // `// @vitest-environment jsdom` pragma.
    environment: "node",
  },
});
