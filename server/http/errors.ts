// EP-3 · Centralized, safe error handling.
// Maps failures to typed HTTP responses without leaking SQL, stack traces, secrets,
// or implementation details. Validation → 400, not-found → 404, DB append-only
// immutability → 409, everything else → a generic 500.
import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

interface ValidationDetail {
  instancePath?: string;
  message?: string;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    // Fastify schema validation failures (malformed / incomplete / injected fields).
    const validation = (err as unknown as { validation?: ValidationDetail[] }).validation;
    if (validation) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Request failed validation.",
        details: validation.map((v) => ({ path: v.instancePath ?? "", message: v.message ?? "" })),
      });
    }

    if (err instanceof NotFoundError) {
      return reply.code(404).send({ error: "not_found", message: err.message });
    }

    // The database append-only triggers raise a message containing 'append-only'.
    // Map it to a clean conflict without exposing the underlying SQL.
    if (/append-only/i.test(String(err?.message ?? ""))) {
      return reply.code(409).send({
        error: "immutable_record",
        message: "Historical records are immutable; create a linked revision instead.",
      });
    }

    // Unknown/internal — log server-side, return a generic message (no leak).
    req.log?.error?.({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal_error", message: "An internal error occurred." });
  });
}
