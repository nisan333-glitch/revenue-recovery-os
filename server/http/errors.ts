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

/** 401 — no valid authenticated identity. Authentication alone never grants access. */
export class UnauthorizedError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** 403 — authenticated but not permitted (least privilege or separation of duties). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** 409 — the request conflicts with an existing state (e.g. duplicate counted recovery). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
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

    if (err instanceof UnauthorizedError) {
      return reply.code(401).send({ error: "unauthorized", message: err.message });
    }
    if (err instanceof ForbiddenError) {
      return reply.code(403).send({ error: "forbidden", message: err.message });
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send({ error: "not_found", message: err.message });
    }
    if (err instanceof ConflictError) {
      return reply.code(409).send({ error: "conflict", message: err.message });
    }
    // Prisma unique-constraint violation — e.g. the one-chain-root-per-case index, the H1
    // chain-fork guard, or the EP-8.1 single-use-outcome-evidence index → 409, generically.
    if ((err as unknown as { code?: string }).code === "P2002") {
      return reply.code(409).send({
        error: "conflict",
        message: "duplicate: a uniqueness constraint was violated (e.g. a proof-chain fork or reused evidence record).",
      });
    }

    // EP-13 · A body over the route's transport limit. Fastify raises this before any handler runs,
    // so it would otherwise fall through to a generic 500 and tell the uploader nothing actionable.
    // Mapped to a deterministic 413 that names the contract's own size rule. The request is refused
    // whole — nothing is ever truncated and then processed as if complete.
    if ((err as unknown as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({
        error: "payload_too_large",
        message:
          "NH-DC-1011: the upload exceeds the maximum accepted size. Split the export by date range and submit each part; the file is refused whole rather than truncated.",
      });
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
