import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/src/**/*.test.ts"],
    // core is headless; the React renderer will opt into jsdom per-file later.
    environment: "node",
  },
});
