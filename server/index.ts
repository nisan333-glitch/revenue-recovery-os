// EP-9 · Process entrypoint. `server/app.ts` only builds the Fastify instance — tests call it
// in-process via `.inject()`, so nothing previously started it as a reachable HTTP server. This
// is the one place that actually listens, so the frontend has something real to call.
import { buildApp } from "./app";
import { createAgentProcessFromEnvironment } from "./agents/bootstrap";
import { configuredAgentHandlers } from "./agents/activationDetector";
import { closeInOrder, installGracefulShutdown } from "./processLifecycle";
import { createIdentityResolverFromEnvironment } from "./auth/verifiedIdentity";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

// Development and the packaged server share the explicit detector opt-in registry.
const handlers = configuredAgentHandlers(process.env);
const agents = createAgentProcessFromEnvironment(process.env, handlers);
const identityResolver = createIdentityResolverFromEnvironment(process.env);
const app = buildApp({ agentReadiness: () => agents.readiness(), identityResolver });
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
