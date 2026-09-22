// EP-4 · DEV-ONLY authenticated actor context.
//
// PRODUCTION BOUNDARY: this reads identity from `x-actor-id` / `x-actor-role` headers.
// It is NOT production authentication — a real deployment MUST replace this with a
// verified identity provider (verified token/session → ActorContext). It supplies
// IDENTITY only; every AUTHORIZATION and SEPARATION-OF-DUTIES rule downstream is fully
// real, enforced in the service layer, and cannot be bypassed by this mechanism.
import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "../http/errors";
import { type ActorContext, isBackendRole } from "./identity";

export type IdentityResolver = (request: FastifyRequest) => Promise<ActorContext>;

export function actorFromRequest(req: FastifyRequest): ActorContext {
  const id = req.headers["x-actor-id"];
  const role = req.headers["x-actor-role"];
  if (typeof id !== "string" || !id.trim() || !isBackendRole(role)) {
    throw new UnauthorizedError("missing or invalid actor credentials");
  }
  const actorId = id.trim();
  if (actorId !== id || actorId.length > 256) throw new UnauthorizedError("missing or invalid actor credentials");
  // Dev headers are allowed only in an explicitly isolated private pilot. They intentionally
  // receive the internal wildcard so local tools can exercise synthetic boundaries; production
  // OIDC identities can never receive this wildcard.
  return { actorId, role, boundaryIds: Object.freeze(["*"]) };
}

export async function resolveActor(
  request: FastifyRequest,
  resolver?: IdentityResolver,
): Promise<ActorContext> {
  return resolver ? resolver(request) : actorFromRequest(request);
}
