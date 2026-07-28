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

export function actorFromRequest(req: FastifyRequest): ActorContext {
  const id = req.headers["x-actor-id"];
  const role = req.headers["x-actor-role"];
  if (typeof id !== "string" || !id.trim() || !isBackendRole(role)) {
    throw new UnauthorizedError("missing or invalid actor credentials");
  }
  return { actorId: id, role };
}
