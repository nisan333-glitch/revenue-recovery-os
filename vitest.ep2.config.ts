// EP-2 persistence test suite (separate from the portable `npm run test` suite so
// the invariant/domain gate stays green in environments without PostgreSQL).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    setupFiles: ["server/test/load-env.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
