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
    include: ["src/**/*.test.ts"],
  },
});
