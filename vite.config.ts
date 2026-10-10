/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // EP-10 · Development parity with production: same-origin `/api/...` reaches the
    // Fastify process (`npm run dev:server`, default port 4000) exactly as it will in
    // the packaged pilot runtime. Forwarded verbatim — `buildApp()`'s own `rewriteUrl`
    // strips the "/api" prefix server-side, so there is one place, not two, that knows
    // about the prefix.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    // `scripts/data-readiness` is included because the local pilot-pair readiness path lives there and
    // its falsifiers must run in CI. They were previously collected by NEITHER suite — `npm run test` is
    // src-only and `test:ep2` is server-only — so a test file under `scripts/` could pass review, be
    // committed, and never execute. A test CI never runs is not a guard.
    //
    // Deliberately narrow: `server/**` has its own Postgres-backed suite and `research/**` is .mjs with a
    // different harness, so neither is swept in here by a broader glob.
    include: ["src/**/*.test.ts", "scripts/data-readiness/**/*.test.ts"],
  },
});
