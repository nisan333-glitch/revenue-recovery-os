// EP-9 · Thin HTTP client for the real governed backend. This is the ONLY place the frontend
// makes network calls for trust/governance data — no component calls `fetch` directly, and this
// module is never imported from `src/assessment/*` (which must stay network-isolated).
//
// Error mapping is deliberately conservative: `server/http/errors.ts` emits a small, closed set
// of stable `error` codes with hand-curated, safe `message` strings for 400/401/403/404/409;
// those are the ONLY messages ever shown verbatim. Anything else — a 500, an unreachable server,
// an unexpected response shape — is replaced with a fixed generic string. Raw Prisma/SQL/stack
// text is never constructed server-side for these paths, and this client does not trust that to
// remain true forever: it refuses to render anything outside the safe set, on principle.
import type { DevActor } from "./devActor";

export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal_error"
  | "network_error";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

const SERVER_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "internal_error",
]);

// Only these codes' server-supplied `message` is safe to show verbatim (server/http/errors.ts
// hand-writes these strings specifically to be user-facing). `internal_error` and anything
// unrecognized always fall back to the generic message below.
const SAFE_TO_SHOW_VERBATIM: ReadonlySet<ApiErrorCode> = new Set([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
]);

const GENERIC_MESSAGE = "Something went wrong talking to the server. Please try again.";

function asApiErrorCode(x: unknown): ApiErrorCode {
  return typeof x === "string" && SERVER_ERROR_CODES.has(x) ? (x as ApiErrorCode) : "internal_error";
}

/** The base path is same-origin (`/api/...`) — the Vite dev server proxies it to the Fastify
 * process, so no CORS handling or base-URL env var is needed for this slice. */
export async function apiRequest<T>(
  method: "GET" | "POST",
  path: string,
  actor: DevActor,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-actor-id": actor.actorId,
        "x-actor-role": actor.role,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network_error", GENERIC_MESSAGE);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const body = parsed as { error?: unknown; message?: unknown } | null;
    const code = asApiErrorCode(body?.error);
    const rawMessage = typeof body?.message === "string" ? body.message : undefined;
    const message = SAFE_TO_SHOW_VERBATIM.has(code) && rawMessage ? rawMessage : GENERIC_MESSAGE;
    throw new ApiError(code, message);
  }

  return parsed as T;
}
