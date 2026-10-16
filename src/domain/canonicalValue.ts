// Deterministic canonical encoding of a plain JSON-ish value.
//
// WHY IT IS IN THE DOMAIN LAYER. It began inside the validation-evidence identity, but it has nothing to do
// with evidence: it is a general statement about how this codebase turns a structure into bytes when the
// bytes are going to be hashed. Two callers now need it — the validation evidence identity and the source
// resolution lineage — and the contract layer may only import from `./`, `../assessment/` and `../domain/`
// (asserted by the layering guard in `pilotDataContract.test.ts`). Widening that allowlist to reach a third
// layer would weaken a guard that exists precisely to stop the contract quietly acquiring dependencies, so
// the shared encoder moved to where it belongs rather than the rule moving to accommodate it.
//
// THE PROPERTIES IT GUARANTEES, each load-bearing for a hash:
//
//   • RECURSIVE KEY ORDERING. Object keys are sorted at EVERY depth. A single-level sort would leave nested
//     objects at the mercy of insertion order, which is the accidental input `JSON.stringify` smuggles in.
//   • ARRAY ORDER IS MEANING. Arrays keep their order, because a list of datasets is not a set.
//   • INJECTIVITY BY LENGTH FRAMING. Every scalar and every key is prefixed with its byte length, so no
//     value can impersonate a delimiter: `["a","bc"]` and `["ab","c"]` cannot collide. Framing rather than
//     separator-joining also means no character has to be forbidden.
//   • REFUSAL OVER GUESSING. A `Date`, a `BigInt`, `NaN`, `undefined`, a function or a class instance each
//     have more than one plausible serialisation. An identity that rests on a guess about which one is not
//     an identity, so they are rejected.

export class NonCanonicalValueError extends Error {
  constructor(path: string, detail: string) {
    super(`value is not canonical at ${path}: ${detail}`);
    this.name = "NonCanonicalValueError";
  }
}

/** UTF-8 byte length using only Web-standard APIs, so this file stays browser-safe. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** `<tag><byteLength>:<value>` — the framing every canonical form is built from. */
export function framed(tag: string, value: string): string {
  return `${tag}${utf8ByteLength(value)}:${value}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Canonical encoding of one value. See the header for the four properties this holds. */
export function canonicalValue(value: unknown, path = "$"): string {
  if (value === null) return "z";
  if (typeof value === "string") return framed("s", value);
  if (typeof value === "boolean") return value ? "bT" : "bF";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new NonCanonicalValueError(path, `non-finite number (${value})`);
    return framed("n", String(value));
  }
  if (Array.isArray(value)) {
    const items = value.map((item, i) => canonicalValue(item, `${path}[${i}]`));
    return `a${items.length}:${items.map((item) => framed("i", item)).join("")}`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => framed("k", key) + framed("v", canonicalValue(value[key], `${path}.${key}`)));
    return `o${keys.length}:${parts.join("")}`;
  }
  const kind =
    typeof value === "function" ? "function"
    : typeof value === "symbol" ? "symbol"
    : typeof value === "bigint" ? "bigint"
    : typeof value === "undefined" ? "undefined"
    : value instanceof Date ? "Date"
    : "non-plain object";
  throw new NonCanonicalValueError(path, `unsupported value type (${kind})`);
}
