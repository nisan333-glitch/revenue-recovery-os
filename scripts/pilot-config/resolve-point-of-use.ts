// WHAT THE STARTUP PROBE CANNOT SEE · FIRST REAL MONEY PROOF §2, second instrument.
//
// WHY A SECOND INSTRUMENT. `verify-config-chain.mjs` boots the real entrypoint and classifies what
// happens. For a variable read at STARTUP that is the whole answer. For a variable read at the POINT
// OF USE it answers nothing, and the first run proved that in the most useful way available: in the
// OIDC posture the control's own `/auth/config` body read
// `{"error":"forbidden","message":"HTTPS is required."}`, because `NH_TLS_TERMINATION=proxy` makes the
// app refuse every plain-HTTP request. So the probe was comparing two identical 403s and reporting
// "identical to the control" — true, and about the probe rather than the subject.
//
//   > A PROBE THE SUBJECT REFUSES IS NOT A MEASUREMENT. It is the same family as *a guard that cannot
//   > fire is no guard* and *a test that cannot fail is not a control*, and it was found only because
//   > the control's own body was printed instead of being trusted.
//
// So the variables whose effect is at the point of use are measured AT the point of use, by calling the
// production resolver that will actually read them. That is not a weaker measurement — it is the
// function the deployment depends on, called with the environment the deployment would have.
import { readPublicAuthConfig } from "../../server/auth/publicAuthConfig";
import { sourceTrustKeysFromEnvironment } from "../../server/services/sourceVerification";
import { settlementDigestKey } from "../../server/persistence/settlementLedgerStore";
import { generateKeyPairSync, randomBytes } from "node:crypto";

const pem = (k: ReturnType<typeof generateKeyPairSync>) =>
  k.publicKey.export({ type: "spki", format: "pem" }).toString();
const evidence = pem(generateKeyPairSync("ed25519"));

const OIDC_BASE: Record<string, string> = {
  NODE_ENV: "production", NH_AUTH_MODE: "oidc",
  NH_OIDC_ISSUER: "https://idp.invalid/realms/probe",
  NH_OIDC_AUDIENCE: "probe",
  NH_OIDC_JWKS_URI: "https://idp.invalid/realms/probe/certs",
  NH_OIDC_CLIENT_ID: "probe-client",
  NH_OIDC_AUTHORIZATION_ENDPOINT: "https://idp.invalid/auth",
  NH_OIDC_TOKEN_ENDPOINT: "https://idp.invalid/token",
  NH_OIDC_TOKEN_USE: "access_token",
  NH_OIDC_SCOPES: "openid profile email",
};
const KEYS_BASE: Record<string, string> = {
  NH_EVIDENCE_SOURCE_KEYS: JSON.stringify([{ keyId: "k1", sourceSystem: "billing", publicKey: evidence }]),
  NH_SETTLEMENT_DIGEST_KEY: randomBytes(32).toString("hex"),
};

const rows: { group: string; variable: string; mutation: string; outcome: string; detail: string }[] = [];
const record = (group: string, variable: string, mutation: string, fn: () => string) => {
  let outcome = "RESOLVED", detail: string;
  try { detail = fn(); } catch (e) { outcome = "REFUSED_AT_USE"; detail = (e as Error).message.slice(0, 150); }
  rows.push({ group, variable, mutation, outcome, detail });
};

// ── The eight OIDC variables, through the function `GET /auth/config` calls ────────────────────────
const authSummary = (env: Record<string, string>) => {
  const c = readPublicAuthConfig(env);
  return c.mode === "oidc" && c.configured
    ? "configured: browser sign-in available"
    : `NOT CONFIGURED · missing=${JSON.stringify((c as { missing?: string[] }).missing ?? [])}`;
};
record("OIDC", "(control)", "complete", () => authSummary(OIDC_BASE));
for (const v of Object.keys(OIDC_BASE).filter((k) => k.startsWith("NH_OIDC_"))) {
  const { [v]: _dropped, ...rest } = OIDC_BASE;
  record("OIDC", v, "drop", () => authSummary(rest as Record<string, string>));
}

// ── Tier C · the evidence trust registry, through the verifier's own resolver ──────────────────────
const keyCount = (env: Record<string, string>) => {
  const keys = sourceTrustKeysFromEnvironment(env);
  const n = Array.isArray(keys) ? keys.length : Object.keys(keys ?? {}).length;
  // ZERO KEYS IS THE WHOLE POINT, so it is stated rather than reported as a bland count: with no
  // registered key no attestation can verify, every evidence record stays `beneficiary_controlled`,
  // and BOTH proof gates refuse. The resolver does not throw, which is exactly why the startup probe
  // saw nothing.
  return n === 0
    ? "0 keys · NO attestation can verify · evidence stays beneficiary_controlled · G1 and G2 both refuse"
    : `${n} key(s) registered`;
};
record("C", "(control)", "complete", () => keyCount(KEYS_BASE));
record("C", "NH_EVIDENCE_SOURCE_KEYS", "drop", () => keyCount({ ...KEYS_BASE, NH_EVIDENCE_SOURCE_KEYS: "" }));
record("C", "NH_EVIDENCE_SOURCE_KEYS", "set=[]", () => keyCount({ ...KEYS_BASE, NH_EVIDENCE_SOURCE_KEYS: "[]" }));

// ── Tier D · the settlement digest key, through the function the claim path calls ──────────────────
record("D", "(control)", "complete", () => `resolved a ${settlementDigestKey(KEYS_BASE).length}-char key`);
record("D", "NH_SETTLEMENT_DIGEST_KEY", "drop",
  () => `resolved ${settlementDigestKey({ ...KEYS_BASE, NH_SETTLEMENT_DIGEST_KEY: "" }).length} chars`);
record("D", "NH_SETTLEMENT_DIGEST_KEY", "set=short",
  () => `resolved ${settlementDigestKey({ ...KEYS_BASE, NH_SETTLEMENT_DIGEST_KEY: "short" }).length} chars`);

const pad = (s: string, n: number) => s.padEnd(n);
console.log("POINT-OF-USE RESOLUTION · the production resolvers, called with the environment a deployment would have\n");
for (const r of rows) {
  console.log(`${pad(r.group, 5)} ${pad(r.variable, 34)} ${pad(r.mutation, 10)} ${pad(r.outcome, 16)} ${r.detail}`);
}
console.log(
  "\nSYNTHETIC AND PURE. Keys are generated for this run and discarded; nothing is deployed, nothing is "
  + "persisted, no customer data is touched, and no observed amount became Revenue Returned.",
);
