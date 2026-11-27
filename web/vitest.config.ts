import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["test/*.test.ts"] } },
      // reads dist/, so it runs after the build
      { extends: true, test: { name: "build", include: ["test/build/*.test.ts"] } },
    ],
  },
});
