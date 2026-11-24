import { defineConfig } from "vitest/config";

// Date formatting in the Jira reports depends on the local time zone.
// Forked test workers inherit this value.
process.env["TZ"] = "UTC";

export default defineConfig({
  test: {
    globalSetup: ["test/global-setup.ts"],
    pool: "forks",
  },
});
