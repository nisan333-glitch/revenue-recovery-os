// EP-10 · Private Pilot Runtime — packaging only, no business logic.
//
// Composes the existing, unmodified governed API (`buildApp()`) with the built React SPA
// onto ONE Fastify instance, so one process on one origin serves the SPA, `/api/*`, and
// `/health` + `/ready` — exactly the shape a single-container private pilot needs. Nothing
// here computes a Tier, a Proof, or a recovered dollar; it only decides which bytes answer
// which URL.
//
// Compiled to CommonJS (tsconfig.server.json) so it runs with a plain `node`, never a
// TypeScript dev runner — `require` below is the native CJS global, not an ESM
// `import.meta` shim, precisely so that compiled output needs no runtime transform.
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { buildApp, apiPrefixedRequests } from "./app";

// Resolved from the process's working directory, not `__dirname` — the compiled artifact
// (dist-server/server/productionServer.js) and the raw TS source (as Vitest runs it,
// server/productionServer.ts) sit at different nesting depths, so a `__dirname`-relative
// path would need a different number of ".." depending on which one is executing. Every
// real invocation (the Docker image's WORKDIR, `node` run from the repo root per the
// README, and `npm test`) starts with the repo root as cwd, so this is the one fixed point.
const SPA_DIST = join(process.cwd(), "dist");
const ASSET_PREFIX = "/assets/";

export function buildProductionApp(): FastifyInstance {
  const app = buildApp();

  app.register(fastifyStatic, {
    root: SPA_DIST,
    // index.html is served automatically for "/" by the plugin's default `index` option.
  });

  // Fires only when no registered route matches at all (never for a legitimate route's own
  // 404, e.g. NotFoundError from proofService — that goes through registerErrorHandler).
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? "";
    // An unknown /api/* call or a missing static asset must look broken, not silently
    // succeed as the SPA shell — the SPA fallback below must never swallow these. `rewriteUrl`
    // (server/app.ts) already stripped "/api" from `url` by this point, so the original
    // prefix is read from `apiPrefixedRequests`, not from the (already-rewritten) URL string.
    if (apiPrefixedRequests.has(req.raw) || url.startsWith(ASSET_PREFIX)) {
      reply.code(404).send({ error: "not_found", message: "Not found." });
      return;
    }
    // Any other unmatched GET is a client-side UI route (e.g. a refresh on /queue/123) —
    // hand back the built shell so the SPA's own router can take over.
    reply.type("text/html").sendFile("index.html", SPA_DIST);
  });

  return app;
}

// Only start listening when this module is actually run as the process entrypoint (`node
// dist-server/server/productionServer.js`) — not when a test imports `buildProductionApp`.
if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "127.0.0.1";

  buildProductionApp()
    .listen({ port, host })
    .then((address) => {
      // PRIVATE PILOT ONLY — see README "Private pilot runtime" for the public-exposure warning.
      console.log(`revenue-recovery-os PRIVATE PILOT server listening on ${address}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
