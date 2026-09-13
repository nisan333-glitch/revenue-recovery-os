// EP-9 · Process entrypoint. `server/app.ts` only builds the Fastify instance — tests call it
// in-process via `.inject()`, so nothing previously started it as a reachable HTTP server. This
// is the one place that actually listens, so the frontend has something real to call.
import { buildApp } from "./app";
import { createAgentProcessFromEnvironment } from "./agents/bootstrap";
import type { AgentHandler } from "./agents/types";
import { closeInOrder, installGracefulShutdown } from "./processLifecycle";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

// Development has the same fail-closed lifecycle as the packaged server. Handlers are registered
// only when a real detector/source adapter exists; NH_AGENTS_ENABLED=true fails until then.
const handlers: readonly AgentHandler[] = [];
const agents = createAgentProcessFromEnvironment(process.env, handlers);
const app = buildApp({ agentReadiness: () => agents.readiness() });
const removeShutdownHandlers = installGracefulShutdown(app, agents);

app
  .listen({ port, host })
  .then(() => {
    agents.start();
    console.log(`revenue-recovery-os server listening on http://${host}:${port}`);
  })
  .catch(async (error) => {
    removeShutdownHandlers();
    try {
      await closeInOrder(app, agents);
    } catch (closeError) {
      console.error(closeError);
    }
    console.error(error);
    process.exit(1);
  });
