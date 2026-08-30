// EP-9 · Process entrypoint. `server/app.ts` only builds the Fastify instance — tests call it
// in-process via `.inject()`, so nothing previously started it as a reachable HTTP server. This
// is the one place that actually listens, so the frontend has something real to call.
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildApp();

app
  .listen({ port, host })
  .then(() => {
    console.log(`revenue-recovery-os server listening on http://${host}:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
